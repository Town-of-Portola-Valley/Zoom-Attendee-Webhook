'use strict';

const { stat } = require('fs').promises;

const { promisify } = require('util');

const zlib = require('zlib');
const brotli = promisify(zlib.brotliCompress);
const gzip = promisify(zlib.gzip);
const deflate = promisify(zlib.deflate);

const logger = require('@hughescr/logger').logger;
const _ = require('lodash');
const { DateTime, Duration } = require('luxon');
DateTime.DATETIME_CLEAR = {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    timeZone: 'America/Los_Angeles',
    timeZoneName: 'short',
};
const pug = require('pug');
const AWS = require('aws-sdk');

const dynamoDB = new AWS.DynamoDB();

/* istanbul ignore next */
const git_version = stat('./git_version.json')
    .then(res => {
        // If we did manage to stat the file, then load it
        return [res, require('./git_version.json')]; // eslint-disable-line node/no-missing-require -- If stat finds the file, it'll be there
    })
    .catch(() => {
        // If we didn't stat the file then hardcode some stuff
        return [{ mtime: new Date() }, { gitVersion: '1.0.0' }];
    });

const AUTHORIZATION_CHECK = process.env.ZOOM_AUTHORIZATION_CODE;
const ORGANIZATION_NAME   = process.env.ORGANIZATION_NAME;
const DB_TABLE            = process.env.DB_TABLE;

const NO_EVENT_RECEIVED = 'No event was received';
const INTERNAL_SERVER_ERROR = 'Internal server error occurred';

const ACCEPT_ENCODING = 'accept-encoding';
const KEEP_ALIVE = 'keep-alive';

const makeHTMLResponse = async (statusCode, body, acceptEncoding = '') => {
    let maybeZipped = {};
    let base64Encoded = false;
    let convertedBody = body;

    if(/\bbr\b/.test(acceptEncoding)) {
        convertedBody = (await brotli(body)).toString('base64');
        maybeZipped = { 'Content-Encoding': 'br' };
        base64Encoded = true;
    } else if(/\bgzip\b/.test(acceptEncoding)) {
        convertedBody = (await gzip(body)).toString('base64');
        maybeZipped = { 'Content-Encoding': 'gzip' };
        base64Encoded = true;
    } else if(/\deflate\b/.test(acceptEncoding)) {
        convertedBody = (await deflate(body)).toString('base64');
        maybeZipped = { 'Content-Encoding': 'deflate' };
        base64Encoded = true;
    }

    return {
        statusCode: statusCode,
        headers: {
            ...maybeZipped,
            'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
            'Content-Security-Policy': "default-src 'self' https:; script-src 'self' https://cdnjs.cloudflare.com; style-src 'self' https://cdnjs.cloudflare.com",
            'X-Frame-Options': 'SAMEORIGIN',
            'X-Content-Type-Options': 'nosniff',
            'Referrer-Policy': 'strict-origin',
            'X-XSS-Protection': '1; mode=block',
            'X-Git-Version': JSON.stringify(await git_version),
            'Content-Type': 'text/html',
            Vary: 'Accept-Encoding',
        },
        isBase64Encoded: base64Encoded,
        body: convertedBody,
    };
};

const makeEmptyResponse = async (statusCode) => {
    return {
        statusCode: statusCode,
        headers: {
            'X-Git-Version': JSON.stringify(await git_version),
        },
    };
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

const listMeetingsTemplate = pug.compileFile('views/list-meetings.pug');

module.exports.handleListMeetings = async (event) => {
    if(!event) {
        logger.error(NO_EVENT_RECEIVED);

        return makeHTMLResponse(500, INTERNAL_SERVER_ERROR);
    }

    if(event[KEEP_ALIVE]) {
        return makeEmptyResponse(204);
    }

    const acceptEncoding = event.headers && event.headers[ACCEPT_ENCODING];

    const statement = `SELECT MeetingID,
                              MeetingTitle,
                              MeetingStartTime,
                              MeetingDuration,
                              ParticipationCount,
                              LastUpdatedAt
                        FROM ${DB_TABLE}."MeetingID-LastUpdatedAt"
                        WHERE LastUpdatedAt > '${DateTime.utc().minus({ days: 7 }).toISO()}'`;

    let nextToken = undefined;
    let items = [];
    do {
        const raw = await dynamoDB.executeStatement({ Statement: statement, nextToken }).promise();
        logger.info('RAW', raw);
        items = [...items, ...raw.Items];
        nextToken = raw.nextToken;
    } while(nextToken);

    const results = _(items)
                    .map(AWS.DynamoDB.Converter.unmarshall)
                    .reduce((sum, i) => {
                        const previous_last_updated = sum[i.MeetingID] && sum[i.MeetingID].LastUpdatedAt || DateTime.now().minus({ years: 1 });
                        const updated = {
                            ...sum[i.MeetingID],
                            MeetingID: i.MeetingID,
                            MeetingTitle: i.MeetingTitle,
                            MeetingStartTime: DateTime.fromISO(i.MeetingStartTime),
                            MeetingDuration: Duration.fromObject({ minutes: i.MeetingDuration }),
                            LastUpdatedAt: DateTime.max(previous_last_updated, DateTime.fromISO(i.LastUpdatedAt)),
                        };
                        updated.ParticipationCount = (updated.ParticipationCount || 0) + i.ParticipationCount;
                        sum[i.MeetingID] = updated;
                        return { ...sum,
                            [`${i.MeetingID}`]: updated,
                        };
                    }, {});
    logger.info({ results: results });

    const response = listMeetingsTemplate({
        DateTime,
        page: { title: `${ORGANIZATION_NAME} Webinars`, version: (await git_version)[1].gitVersion },
        meetings: [
            {
                title: 'Active Meetings',
                meetings: _(results).map().filter('ParticipationCount').sortBy('MeetingStartTime').reverse().value(),
            },
            {
                title: 'Ended Meetings (within last 7 days)',
                meetings: _(results).map().filter(i => !i.ParticipationCount).sortBy('MeetingStartTime').reverse().value(),
            }
        ],
    });

    return makeHTMLResponse(200, response, acceptEncoding);
};

const listParticipantsTemplate = pug.compileFile('views/list-participants.pug');

module.exports.handleListParticipants = async (event) => {
    if(!event) {
        logger.error(NO_EVENT_RECEIVED);

        return makeHTMLResponse(500, INTERNAL_SERVER_ERROR);
    }

    if(event[KEEP_ALIVE]) {
        return makeEmptyResponse(204);
    }

    const acceptEncoding = event.headers && event.headers[ACCEPT_ENCODING];
    const meetingID = event.pathParameters.meeting_id;

    const statement = `SELECT MeetingID,
                              MeetingTitle,
                              MeetingStartTime,
                              MeetingDuration,
                              ParticipantName,
                              ParticipantEmail,
                              ParticipationCount,
                              JoinTimes,
                              LeaveTimes
                        FROM ${DB_TABLE}."MeetingID-ParticipationCount"
                        WHERE MeetingID = ${meetingID}`;

    let nextToken = undefined;
    let items = [];
    do {
        const raw = await dynamoDB.executeStatement({ Statement: statement, nextToken }).promise();
        logger.info('RAW', raw);
        items = [...items, ...raw.Items];
        nextToken = raw.nextToken;
    } while(nextToken);

    const MeetingTitle = items[0].MeetingTitle.S;
    const MeetingID = items[0].MeetingID.N;
    const MeetingStartTime = DateTime.fromISO(items[0].MeetingStartTime.S);
    const MeetingDuration = Duration.fromObject({ minutes: items[0].MeetingDuration.N });
    const ParticipantCount = items.length;

    const results = _(items)
                    .map(AWS.DynamoDB.Converter.unmarshall)
                    .map(i => ({
                            ...i,
                            MeetingStartTime: DateTime.fromISO(i.MeetingStartTime),
                            MeetingDuration: Duration.fromObject({ minutes: i.MeetingDuration }),
                            JoinTime: i.ParticipationCount ? _(i.JoinTimes.values).sortBy().map(DateTime.fromISO).last() : DateTime.now(), // Find the latest join time
                            LeaveTime: i.ParticipationCount ? DateTime.now() : _(i.LeaveTimes.values).sortBy().map(DateTime.fromISO).last(),
                            ParticipationCount: i.ParticipationCount ? 1 : 0,
                    }))
                    .groupBy('ParticipationCount')
                    .value();
    logger.info({ results: results });

    const response = listParticipantsTemplate({
        DateTime,
        page: { version: (await git_version)[1].gitVersion },
        meeting: {
            MeetingTitle,
            MeetingID,
            MeetingStartTime,
            MeetingDuration,
            ParticipantCount,
            CurrentCount: results['1'] ? results['1'].length : 0,
        },
        participants: [
            {
                title: 'Online',
                participants: _(results['1']).sortBy('JoinTime').reverse().value(),
            },
            {
                title: 'Left the meeting',
                participants: _(results['0']).sortBy('LeaveTime').reverse().value(),
            }
        ],
    });

    return makeHTMLResponse(200, response, acceptEncoding);
};
