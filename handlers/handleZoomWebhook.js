'use strict';

const logger = require('@hughescr/logger').logger;

const {
        makeHTMLResponse,
        makeEmptyResponse,
        dynamoDB,
        NO_EVENT_RECEIVED,
        INTERNAL_SERVER_ERROR,
        KEEP_ALIVE,
        ACCEPT_ENCODING,
        AUTHORIZATION_CHECK,
        DB_TABLE,
      } = require('./helpers.js');

const { DateTime } = require('luxon');

// Handle a POST request from the Zoom webhook
// Currently handles these events:
// - webinar.participant_joined
// - webinat.participant_left
//
// Returns:
//  - 500 with HTML error doc if something weird happend on the AWS side
//  - 401 if called without correct authorization header
//  - 400 if called with correct authorization header but no request body
//  - 422 if called with a request body but that body is missing either `payload` or `event` inside its JSON
//  - 422 if called with an event that is not handled
//  - 204 if handled

module.exports.handleZoomWebhook = async (event) => {
    if(!event) {
        logger.error(NO_EVENT_RECEIVED);

        return makeHTMLResponse(500, INTERNAL_SERVER_ERROR);
    }

    if(event[KEEP_ALIVE]) {
        return makeEmptyResponse(204);
    }

    if(!event.headers) {
        logger.error('No headers were in the event', event);

        return makeHTMLResponse(500, INTERNAL_SERVER_ERROR);
    }

    const acceptEncoding = event.headers[ACCEPT_ENCODING];

    if(event.headers.authorization !== AUTHORIZATION_CHECK) {
        logger.error('Failed to authenticate request', event);

        return makeHTMLResponse(401, 'Authorization header failed to match requirements', acceptEncoding);
    }

    if(!event.body) {
        logger.error('There was no body/payload in the event', event);

        return makeHTMLResponse(400, 'No content was sent in the request body', acceptEncoding);
    }

    const body = JSON.parse(event.body);

    if(!body || !body.payload || !body.event) {
        logger.error('The body exists, and is valid JSON, but appears to have invalid content', event.body);

        return makeHTMLResponse(422, 'The body must contain a payload and an event', acceptEncoding);
    }

    // At this point the body looks good; has an event and a payload
    logger.info({ payload: body.payload });

    let joined, left, statement, params;
    switch(body.event) {
        case 'webinar.participant_joined':
            joined = {
                webinar: {
                    MeetingID: body.payload.object.id,
                    MeetingTitle: body.payload.object.topic,
                    MeetingStartTime: body.payload.object.start_time,
                    MeetingDuration: body.payload.object.duration,
                },
                participant: {
                    ParticipantID: body.payload.object.participant.participant_user_id || body.payload.object.participant.user_name,
                    ParticipantSessionID: body.payload.object.participant.user_id,
                    ParticipantName: body.payload.object.participant.user_name,
                    ParticipantEmail: body.payload.object.participant.email,
                    JoinTime: body.payload.object.participant.join_time,
                },
                LastUpdatedAt: DateTime.utc().toISO(),
                EventTimestamp: body.event_ts,
            };
            logger.info({ JOINED: joined });

            statement = `UPDATE ${DB_TABLE}
                SET MeetingTitle=?
                SET MeetingStartTime=?
                SET MeetingDuration=?
                SET ParticipantSessionIDs=set_add(ParticipantSessionIDs, <<${joined.participant.ParticipantSessionID}>>)
                SET ParticipantName=?
                SET ParticipantEmail=?
                SET JoinTimes=set_add(JoinTimes, <<'${joined.participant.JoinTime}'>>)
                SET ParticipationCount=ParticipationCount+1
                SET LastUpdatedAt=?
                SET EventTimestamps=set_add(EventTimestamps, <<${joined.EventTimestamp}>>)
                WHERE MeetingID=?
                AND ParticipantID=?
                AND NOT contains(EventTimestamps, ?)
            `;
            params = [
                { S: joined.webinar.MeetingTitle },
                { S: joined.webinar.MeetingStartTime },
                { N: joined.webinar.MeetingDuration.toString() },
                { S: joined.participant.ParticipantName },
                { S: joined.participant.ParticipantEmail },
                { S: DateTime.utc().toISO() },
                { N: joined.webinar.MeetingID },
                { S: joined.participant.ParticipantID },
                { N: joined.EventTimestamp.toString() },
            ];

            await dynamoDB.executeStatement({
                Statement: statement,
                Parameters: params,
            }).promise()
            .catch(err => {
                // The update failed, which means no record was found - either the participant hasn't been in the meeting yet
                // OR
                // This event has already been processed, but took longer than 3000ms and timed out on the client side, so
                // Zoom is resending the event; we de-dupe the event timestamp per participant/meeting so if this timestamp
                // was seen before, update will fail; we then will try insert which also should fail.
                // If the user/meeting DID NOT exist, then the insert will succeed.
                logger.info('Update failed', { err: err });
                statement = `INSERT INTO ${DB_TABLE}
                      VALUE { 'MeetingID':?,
                              'ParticipantID':?,
                              'MeetingTitle':?,
                              'MeetingStartTime':?,
                              'MeetingDuration':?,
                              'ParticipantSessionIDs':?,
                              'ParticipantName':?,
                              'ParticipantEmail':?,
                              'JoinTimes':?,
                              'ParticipationCount':?,
                              'LastUpdatedAt':?,
                              'EventTimestamps':?
                          }
                `;
                params = [
                    { N: joined.webinar.MeetingID },
                    { S: joined.participant.ParticipantID },
                    { S: joined.webinar.MeetingTitle },
                    { S: joined.webinar.MeetingStartTime },
                    { N: joined.webinar.MeetingDuration.toString() },
                    { NS: [joined.participant.ParticipantSessionID] },
                    { S: joined.participant.ParticipantName },
                    { S: joined.participant.ParticipantEmail },
                    { SS: [joined.participant.JoinTime] },
                    { N: '1' },
                    { S: DateTime.utc().toISO() },
                    { NS: [joined.EventTimestamp.toString()] },
                ];

                return dynamoDB.executeStatement({
                    Statement: statement,
                    Parameters: params,
                }).promise();
            })
            .catch(err => {
                // We should only arrive here if this is a duplicate event
                logger.info('Duplicate event; ignoring', { err: err });
            });

            break;

        case 'webinar.participant_left':
            left = {
                webinar: {
                    MeetingID: body.payload.object.id,
                    MeetingTitle: body.payload.object.topic,
                    MeetingStartTime: body.payload.object.start_time,
                    MeetingDuration: body.payload.object.duration,
                },
                participant: {
                    ParticipantID: body.payload.object.participant.participant_user_id || body.payload.object.participant.user_name,
                    ParticipantSessionID: body.payload.object.participant.user_id,
                    ParticipantName: body.payload.object.participant.user_name,
                    ParticipantEmail: body.payload.object.participant.email,
                    LeaveTime: body.payload.object.participant.leave_time,
                },
                LastUpdatedAt: DateTime.utc().toISO(),
                EventTimestamp: +body.event_ts,
            };
            logger.info({ LEFT: left });
            statement = `UPDATE ${DB_TABLE}
                SET MeetingTitle=?
                SET MeetingStartTime=?
                SET MeetingDuration=?
                SET ParticipantSessionIDs=set_add(ParticipantSessionIDs, <<${left.participant.ParticipantSessionID}>>)
                SET ParticipantName=?
                SET ParticipantEmail=?
                SET LeaveTimes=set_add(LeaveTimes, <<'${left.participant.LeaveTime}'>>)
                SET ParticipationCount=ParticipationCount-1
                SET LastUpdatedAt=?
                SET EventTimestamps=set_add(EventTimestamps, <<${left.EventTimestamp}>>)
                WHERE MeetingID=?
                AND ParticipantID=?
                AND NOT contains(EventTimestamps, ?)
            `;
            params = [
                { S: left.webinar.MeetingTitle },
                { S: left.webinar.MeetingStartTime },
                { N: left.webinar.MeetingDuration.toString() },
                { S: left.participant.ParticipantName },
                { S: left.participant.ParticipantEmail },
                { S: DateTime.utc().toISO() },
                { N: left.webinar.MeetingID },
                { S: left.participant.ParticipantID },
                { N: left.EventTimestamp.toString() },
            ];

            await dynamoDB.executeStatement({
                Statement: statement,
                Parameters: params,
            }).promise()
            .catch(err => {
                // The update failed, which means no record was found - either the participant hasn't been in the meeting yet
                // OR
                // This event has already been processed, but took longer than 3000ms and timed out on the client side, so
                // Zoom is resending the event; we de-dupe the event timestamp per participant/meeting so if this timestamp
                // was seen before, update will fail; we then will try insert which also should fail.
                // If the user/meeting DID NOT exist, then the insert will succeed.
                logger.info('Update failed', { err: err });
                statement = `INSERT INTO ${DB_TABLE}
                      VALUE { 'MeetingID':?,
                              'ParticipantID':?,
                              'MeetingTitle':?,
                              'MeetingStartTime':?,
                              'MeetingDuration':?,
                              'ParticipantSessionIDs':?,
                              'ParticipantName':?,
                              'ParticipantEmail':?,
                              'LeaveTimes':?,
                              'ParticipationCount':?,
                              'LastUpdatedAt':?,
                              'EventTimestamps':?
                          }
                `;
                params = [
                    { N: left.webinar.MeetingID },
                    { S: left.participant.ParticipantID },
                    { S: left.webinar.MeetingTitle },
                    { S: left.webinar.MeetingStartTime },
                    { N: left.webinar.MeetingDuration.toString() },
                    { NS: [left.participant.ParticipantSessionID] },
                    { S: left.participant.ParticipantName },
                    { S: left.participant.ParticipantEmail },
                    { SS: [left.participant.LeaveTime] },
                    { N: '0' },
                    { S: DateTime.utc().toISO() },
                    { NS: [left.EventTimestamp.toString()] },
                ];

                return dynamoDB.executeStatement({
                    Statement: statement,
                    Parameters: params,
                }).promise();
            })
            .catch(err => {
                // We should only arrive here if this is a duplicate event
                logger.info('Duplicate event; ignoring', { err: err });
            });

            break;

        default:
            logger.error('Unexpected event type', body);

            return makeHTMLResponse(422, `Unexpected event type: ${body.event}`, acceptEncoding);
    }

    return makeEmptyResponse(204);
};
