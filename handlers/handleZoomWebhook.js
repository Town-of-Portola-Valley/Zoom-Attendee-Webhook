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

const makeJoinOrLeaveObject = async (joined, payload, event_ts) => {
    const joinedOrLeft = {
        webinar: {
            MeetingID: payload.object.id,
            MeetingTitle: payload.object.topic,
            MeetingStartTime: payload.object.start_time,
            MeetingDuration: payload.object.duration,
        },
        participant: {
            ParticipantID: payload.object.participant.participant_user_id || payload.object.participant.user_name,
            ParticipantSessionID: payload.object.participant.user_id,
            ParticipantName: payload.object.participant.user_name,
            ParticipantEmail: payload.object.participant.email,
        },
        LastUpdatedAt: DateTime.utc().toISO(),
        EventTimestamp: event_ts,
    };
    if(joined) {
        joinedOrLeft.participant.JoinTime = payload.object.participant.join_time;
    } else {
        joinedOrLeft.participant.LeaveTime = payload.object.participant.leave_time;
    }

    return joinedOrLeft;
};

const updateJoinOrLeaveIfExists = async (joined, joinOrLeave) => {
    const joinLeaveFieldName = joined ? 'JoinTimes' : 'LeaveTimes';
    const joinLeaveTimeValue = joined ? joinOrLeave.participant.JoinTime : joinOrLeave.participant.LeaveTime;
    const statement = `UPDATE ${DB_TABLE}
        SET MeetingTitle=?
        SET MeetingStartTime=?
        SET MeetingDuration=?
        SET ParticipantSessionIDs=set_add(ParticipantSessionIDs, <<${joinOrLeave.participant.ParticipantSessionID}>>)
        SET ParticipantName=?
        SET ParticipantEmail=?
        SET ${joinLeaveFieldName}=set_add(${joinLeaveFieldName}, <<'${joinLeaveTimeValue}'>>)
        SET ParticipationCount=ParticipationCount ${joined ? '+' : '-'} 1
        SET LastUpdatedAt=?
        SET EventTimestamps=set_add(EventTimestamps, <<${joinOrLeave.EventTimestamp}>>)
        WHERE MeetingID=?
        AND ParticipantID=?
        AND NOT contains(EventTimestamps, ?)
    `;
    const params = [
        { S: joinOrLeave.webinar.MeetingTitle },
        { S: joinOrLeave.webinar.MeetingStartTime },
        { N: joinOrLeave.webinar.MeetingDuration.toString() },
        { S: joinOrLeave.participant.ParticipantName },
        { S: joinOrLeave.participant.ParticipantEmail },
        { S: DateTime.utc().toISO() },
        { N: joinOrLeave.webinar.MeetingID },
        { S: joinOrLeave.participant.ParticipantID },
        { N: joinOrLeave.EventTimestamp.toString() },
    ];

    return dynamoDB.executeStatement({
        Statement: statement,
        Parameters: params,
    }).promise();
};

const insertJoinOrLeaveIfNotExists = async (joined, joinOrLeave) => {
    const joinLeaveFieldName = joined ? 'JoinTimes' : 'LeaveTimes';
    const joinLeaveTimeValue = joined ? joinOrLeave.participant.JoinTime : joinOrLeave.participant.LeaveTime;
    const statement = `INSERT INTO ${DB_TABLE}
          VALUE { 'MeetingID':?,
                  'ParticipantID':?,
                  'MeetingTitle':?,
                  'MeetingStartTime':?,
                  'MeetingDuration':?,
                  'ParticipantSessionIDs':?,
                  'ParticipantName':?,
                  'ParticipantEmail':?,
                  '${joinLeaveFieldName}':?,
                  'ParticipationCount':?,
                  'LastUpdatedAt':?,
                  'EventTimestamps':?
              }
    `;
    const params = [
        { N: joinOrLeave.webinar.MeetingID },
        { S: joinOrLeave.participant.ParticipantID },
        { S: joinOrLeave.webinar.MeetingTitle },
        { S: joinOrLeave.webinar.MeetingStartTime },
        { N: joinOrLeave.webinar.MeetingDuration.toString() },
        { NS: [joinOrLeave.participant.ParticipantSessionID] },
        { S: joinOrLeave.participant.ParticipantName },
        { S: joinOrLeave.participant.ParticipantEmail },
        { SS: [joinLeaveTimeValue] },
        { N: joined ? '1' : '0' },
        { S: DateTime.utc().toISO() },
        { NS: [joinOrLeave.EventTimestamp.toString()] },
    ];

    return dynamoDB.executeStatement({
        Statement: statement,
        Parameters: params,
    }).promise();
};

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

    let joined;
    switch(body.event) {
        case 'webinar.participant_joined':
            joined = true;
            break;

        case 'webinar.participant_left':
            joined = false;
            break;

        default:
            logger.error('Unexpected event type', body);

            return makeHTMLResponse(422, `Unexpected event type: ${body.event}`, acceptEncoding);
    }

    const joinedOrLeft = await makeJoinOrLeaveObject(true, body.payload, +body.event_ts);
    logger.info({ [`${joined ? 'JOINED' : 'LEFT' }`]: joinedOrLeft });

    updateJoinOrLeaveIfExists(joined, joinedOrLeft)
    .catch(err => {
        // The update failed, which means no record was found - either the participant hasn't been in the meeting yet
        // OR
        // This event has already been processed, but took longer than 3000ms and timed out on the client side, so
        // Zoom is resending the event; we de-dupe the event timestamp per participant/meeting so if this timestamp
        // was seen before, update will fail; we then will try insert which also should fail.
        // If the user/meeting DID NOT exist, then the insert will succeed.
        logger.info('Update failed', { err: err });

        return insertJoinOrLeaveIfNotExists(joined, joinedOrLeft);
    })
    .catch(err => {
        // We should only arrive here if this is a duplicate event
        logger.info('Duplicate event; ignoring', { err: err });
    });

    return makeEmptyResponse(204);
};
