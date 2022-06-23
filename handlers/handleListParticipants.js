'use strict';

const logger = require('@hughescr/logger').logger;
const _ = require('lodash');
const pug = require('pug');

const {
        makeHTMLResponse,
        makeEmptyResponse,
        dynamoDB,
        NO_EVENT_RECEIVED,
        INTERNAL_SERVER_ERROR,
        KEEP_ALIVE,
        ACCEPT_ENCODING,
        DB_TABLE,
        DATETIME_CLEAR,
        git_version,
      } = require('./helpers.js');

const { DateTime, Duration } = require('luxon');
DateTime.DATETIME_CLEAR = DATETIME_CLEAR;

const AWS = require('aws-sdk');

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

    const { MeetingTitle, MeetingID, MeetingStartTime, MeetingDuration, ParticipantCount, results } =
        (items.length === 0) ? {
            MeetingTitle : 'This meeting does not exist',
            MeetingID : event.pathParameters.meeting_id,
            MeetingStartTime : DateTime.now(),
            MeetingDuration : Duration.fromObject({ minutes: 0 }),
            ParticipantCount : 0,
            results: {},
        } : {
            MeetingTitle : items[0].MeetingTitle.S,
            MeetingID : items[0].MeetingID.N,
            MeetingStartTime : DateTime.fromISO(items[0].MeetingStartTime.S),
            MeetingDuration : Duration.fromObject({ minutes: items[0].MeetingDuration.N }),
            ParticipantCount : items.length,
            results: _(items)
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
                    .value(),
        };

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
        participants: items.length ? [
            {
                title: 'Online',
                participants: _(results['1']).sortBy('JoinTime').reverse().value(),
            },
            {
                title: 'Left the meeting',
                participants: _(results['0']).sortBy('LeaveTime').reverse().value(),
            }
        ] : [
            {
                title: 'There is no record of any participant',
                participants: [],
            }
        ],
    });

    return makeHTMLResponse(200, response, acceptEncoding);
};
