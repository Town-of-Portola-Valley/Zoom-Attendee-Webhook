'use strict';

const fs = require('fs');
const promisify = require('util').promisify;
const stat = promisify(fs.stat);
const zlib = require('zlib');
const brotli = promisify(zlib.brotliCompress);
const gzip = promisify(zlib.gzip);
const deflate = promisify(zlib.deflate);

const logger = require('@hughescr/logger').logger;
const _ = require('lodash');
const { DateTime, Duration } = require('luxon');
const AWS = require('aws-sdk');
const pluralize = require('pluralize');

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

const ACCEPT_ENCODING = 'accept-encoding';

const makeHTMLResponse = async (statusCode, body, acceptEncoding) => {
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
    const headers = {
        'X-Git-Version': JSON.stringify(await git_version),
    };

    if(!event) {
        logger.error('No event was received');

        return makeHTMLResponse(500, 'Internal server error occurred', '');
    }

    if(!event.headers) {
        logger.error('No headers were in the event', event);

        return makeHTMLResponse(500, 'Internal server error occurred', '');
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
                    ParticipantID: body.payload.object.participant.id || body.payload.object.participant.user_name,
                    ParticipantSessionID: body.payload.object.participant.user_id,
                    ParticipantName: body.payload.object.participant.user_name,
                    ParticipantEmail: body.payload.object.participant.email,
                    JoinTime: body.payload.object.participant.join_time,
                },
                LastUpdatedAt: DateTime.utc().toISO(),
            };
            logger.info({ JOINED: joined });

            statement = `UPDATE PVWebinarAttendees
                SET MeetingTitle=?
                SET MeetingStartTime=?
                SET MeetingDuration=?
                SET ParticipantSessionIDs=set_add(ParticipantSessionIDs, <<${joined.participant.ParticipantSessionID}>>)
                SET ParticipantName=?
                SET ParticipantEmail=?
                SET JoinTimes=set_add(JoinTimes, <<'${joined.participant.JoinTime}'>>)
                SET ParticipationCount=ParticipationCount+1
                SET LastUpdatedAt=?
                WHERE MeetingID=?
                AND ParticipantID=?
            `;
            params = [
                { S: joined.webinar.MeetingTitle },
                { S: joined.webinar.MeetingStartTime },
                { N: `${joined.webinar.MeetingDuration}` },
                { S: joined.participant.ParticipantName },
                { S: joined.participant.ParticipantEmail },
                { S: DateTime.utc().toISO() },
                { N: `${joined.webinar.MeetingID}` },
                { S: joined.participant.ParticipantID },
            ];

            await dynamoDB.executeStatement({
                Statement: statement,
                Parameters: params,
            }).promise()
            .catch(err => {
                logger.warn({ err: err });
                statement = `INSERT INTO PVWebinarAttendees
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
                              'LastUpdatedAt':?
                          }
                `;
                params = [
                    { N: `${joined.webinar.MeetingID}` },
                    { S: joined.participant.ParticipantID },
                    { S: joined.webinar.MeetingTitle },
                    { S: joined.webinar.MeetingStartTime },
                    { N: `${joined.webinar.MeetingDuration}` },
                    { NS: [`${joined.participant.ParticipantSessionID}`] },
                    { S: joined.participant.ParticipantName },
                    { S: joined.participant.ParticipantEmail },
                    { SS: [joined.participant.JoinTime] },
                    { N: '1' },
                    { S: DateTime.utc().toISO() },
                ];

                return dynamoDB.executeStatement({
                    Statement: statement,
                    Parameters: params,
                }).promise();
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
                    ParticipantID: body.payload.object.participant.id || body.payload.object.participant.user_name,
                    ParticipantSessionID: body.payload.object.participant.user_id,
                    ParticipantName: body.payload.object.participant.user_name,
                    ParticipantEmail: body.payload.object.participant.email,
                    LeaveTime: body.payload.object.participant.leave_time,
                },
                LastUpdatedAt: DateTime.utc().toISO(),
            };
            logger.info({ LEFT: left });
            statement = `UPDATE PVWebinarAttendees
                SET MeetingTitle=?
                SET MeetingStartTime=?
                SET MeetingDuration=?
                SET ParticipantSessionIDs=set_add(ParticipantSessionIDs, <<${left.participant.ParticipantSessionID}>>)
                SET ParticipantName=?
                SET ParticipantEmail=?
                SET LeaveTimes=set_add(LeaveTimes, <<'${left.participant.LeaveTime}'>>)
                SET ParticipationCount=ParticipationCount-1
                SET LastUpdatedAt=?
                WHERE MeetingID=?
                AND ParticipantID=?
            `;
            params = [
                { S: left.webinar.MeetingTitle },
                { S: left.webinar.MeetingStartTime },
                { N: `${left.webinar.MeetingDuration}` },
                { S: left.participant.ParticipantName },
                { S: left.participant.ParticipantEmail },
                { S: DateTime.utc().toISO() },
                { N: `${left.webinar.MeetingID}` },
                { S: left.participant.ParticipantID },
            ];

            await dynamoDB.executeStatement({
                Statement: statement,
                Parameters: params,
            }).promise()
            .catch(err => {
                logger.warn({ err: err });
                statement = `INSERT INTO PVWebinarAttendees
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
                              'LastUpdatedAt':?
                          }
                `;
                params = [
                    { N: `${left.webinar.MeetingID}` },
                    { S: left.participant.ParticipantID },
                    { S: left.webinar.MeetingTitle },
                    { S: left.webinar.MeetingStartTime },
                    { N: `${left.webinar.MeetingDuration}` },
                    { NS: [`${left.participant.ParticipantSessionID}`] },
                    { S: left.participant.ParticipantName },
                    { S: left.participant.ParticipantEmail },
                    { SS: [left.participant.LeaveTime] },
                    { N: '0' },
                    { S: DateTime.utc().toISO() },
                ];

                return dynamoDB.executeStatement({
                    Statement: statement,
                    Parameters: params,
                }).promise();
            });

            break;

        default:
            logger.error('Unexpected event type', body);

            return makeHTMLResponse(422, `Unexpected event type: ${body.event}`, acceptEncoding);
    }

    return {
        ...headers,
        statusCode: 204,
    };
};

module.exports.handleListMeetings = async (event) => {
    if(!event) {
        logger.error('No event was received');

        return makeHTMLResponse(500, 'Internal server error occurred');
    }

    const acceptEncoding = event.headers[ACCEPT_ENCODING];

    const statement = `SELECT MeetingID,
                              MeetingTitle,
                              MeetingStartTime,
                              MeetingDuration,
                              ParticipationCount,
                              LastUpdatedAt
                        FROM PVWebinarAttendees."MeetingID-LastUpdatedAt"
                        WHERE LastUpdatedAt > '${DateTime.utc().minus({ days: 7 }).toISO()}'`;

    const raw = await dynamoDB.executeStatement({ Statement: statement }).promise();
    logger.info('RAW', raw);

    const results = _(raw.Items)
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

    const response = `
    <html>
        <head><title>Active Portola Valley Webinars</title></head>
        <body>
            <h1>Active Portola Valley Webinars</h1>
            <h4>Active Meetings</h4>
            ${_(results).map().find('ParticipationCount') ? '' : '&mdash; None &mdash;'}
            <dl>
            ${_(results).map().filter('ParticipationCount').sortBy('MeetingStartTime').reverse().map(i =>
           `<dt><a href="meeting/${i.MeetingID}">${i.MeetingTitle}</a></dt>
            <dd>Started at ${i.MeetingStartTime.setZone('America/Los_Angeles').toLocaleString(DateTime.DATETIME_SHORT)} (${i.MeetingStartTime.toRelative()})<br/>
                Scheduled to end at ${i.MeetingStartTime.setZone('America/Los_Angeles').plus(i.MeetingDuration).toLocaleString(DateTime.DATETIME_SHORT)} (${i.MeetingStartTime.plus(i.MeetingDuration).toRelative()})<br/>
                ${pluralize('participant', i.ParticipationCount, true)} since ${i.LastUpdatedAt.setZone('America/Los_Angeles').toLocaleString(DateTime.DATETIME_SHORT)} (${i.LastUpdatedAt.toRelative()})
            </dd>`).join('')}
            </dl>
            <h4>Past Meetings</h4>
            ${_(results).map().find(i => !i.ParticipationCount) ? '' : '&mdash; None &mdash;'}
            <dl>
            ${_(results).map().filter(i => !i.ParticipationCount).sortBy('MeetingStartTime').reverse().map(i =>
           `<dt><a href="meeting/${i.MeetingID}">${i.MeetingTitle}</a></dt>
            <dd>Started at ${i.MeetingStartTime.setZone('America/Los_Angeles').toLocaleString(DateTime.DATETIME_SHORT)} (${i.MeetingStartTime.toRelative()})<br/>
                Scheduled to end at ${i.MeetingStartTime.setZone('America/Los_Angeles').plus(i.MeetingDuration).toLocaleString(DateTime.DATETIME_SHORT)} (${i.MeetingStartTime.plus(i.MeetingDuration).toRelative()})<br/>
                ${pluralize('participant', i.ParticipationCount, true)} since ${i.LastUpdatedAt.setZone('America/Los_Angeles').toLocaleString(DateTime.DATETIME_SHORT)} (${i.LastUpdatedAt.toRelative()})
            </dd>`).join('')}
            </dl>
        </body>
    </html>
    `;

    return makeHTMLResponse(200, response, acceptEncoding);
};

module.exports.handleListParticipants = async (event) => {
    if(!event) {
        logger.error('No event was received');

        return makeHTMLResponse(500, 'Internal server error occurred');
    }

    const acceptEncoding = event.headers[ACCEPT_ENCODING];
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
                        FROM PVWebinarAttendees."MeetingID-ParticipationCount"
                        WHERE MeetingID = ${meetingID}`;

    const raw = await dynamoDB.executeStatement({ Statement: statement }).promise();
    logger.info('RAW', raw);

    const MeetingTitle = raw.Items[0].MeetingTitle.S;
    const MeetingID = raw.Items[0].MeetingID.N;
    const MeetingStartTime = DateTime.fromISO(raw.Items[0].MeetingStartTime.S);
    const MeetingDuration = Duration.fromObject({ minutes: raw.Items[0].MeetingDuration.N });
    const participantCount = raw.Items.length;

    const results = _(raw.Items)
                    .map(AWS.DynamoDB.Converter.unmarshall)
                    .map(i => ({
                            ...i,
                            MeetingStartTime: DateTime.fromISO(i.MeetingStartTime),
                            MeetingDuration: Duration.fromObject({ minutes: i.MeetingDuration }),
                            JoinTime: i.ParticipationCount ? _(i.JoinTimes.values).sortBy().map(DateTime.fromISO).last() : DateTime.now(), // Find the latest join time
                            LeaveTime: i.ParticipationCount ? DateTime.now() : _(i.LeaveTimes.values).sortBy().map(DateTime.fromISO).last(),
                    }))
                    .groupBy('ParticipationCount')
                    .value();
    logger.info({ results: results });

    const response = `
    <html>
        <head><title>${MeetingTitle} (${MeetingID})</title></head>
        <body>
            <h1>${MeetingTitle} (${MeetingID})</h1>
            <h2>Started ${MeetingStartTime.toRelative()},
             scheduled to end ${MeetingStartTime.plus(MeetingDuration).toRelative()}</h2>
            <h3>Total: ${pluralize('participant', participantCount, true)}</h3>
            <h4>Current Participants: ${results['1'] ? results['1'].length : 0}</h4>
            ${results['1'] ? '' : '&mdash; None &mdash;'}
            <dl>
            ${_(results['1']).sortBy('JoinTime').reverse().map(i =>
               `<dt>${i.ParticipantName}${i.ParticipantEmail ? ` &lt;${i.ParticipantEmail}&gt;` : ''}</dt>
                <dd>Joined the meeting at ${i.JoinTime.toLocaleString(DateTime.DATETIME_SHORT)} (${i.JoinTime.toRelative()})</dd>`).join('')}
            </dl>
            <h4>Past Participants: ${results['0'] ? results['0'].length : 0}</h4>
            ${results['0'] ? '' : '&mdash; None &mdash;'}
            <dl>
            ${_(results['0']).sortBy('LeaveTime').reverse().map(i =>
               `<dt>${i.ParticipantName}${i.ParticipantEmail ? ` &lt;${i.ParticipantEmail}&gt;` : ''}</dt>
                <dd>Left the meeting at ${i.LeaveTime.toLocaleString(DateTime.DATETIME_SHORT)} (${i.LeaveTime.toRelative()})</dd>`).join('')}
            </dl>
        </body>
    </html>
    `;

    return makeHTMLResponse(200, response, acceptEncoding);
};
