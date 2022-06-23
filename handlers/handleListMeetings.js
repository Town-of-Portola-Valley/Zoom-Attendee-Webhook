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
        ORGANIZATION_NAME,
        git_version,
      } = require('./helpers.js');

const { DateTime, Duration } = require('luxon');
DateTime.DATETIME_CLEAR = DATETIME_CLEAR;

const AWS = require('aws-sdk');

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

    const numDays = event.queryStringParameters && event.queryStringParameters.numDays && parseInt(event.queryStringParameters.numDays) || 7;

    const statement = `SELECT MeetingID,
                              MeetingTitle,
                              MeetingStartTime,
                              MeetingDuration,
                              ParticipationCount,
                              LastUpdatedAt
                        FROM ${DB_TABLE}."MeetingID-LastUpdatedAt"
                        WHERE LastUpdatedAt > '${DateTime.utc().minus({ days: numDays }).toISO()}'`;

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
                title: 'Ended Meetings',
                numDays,
                meetings: _(results).map().filter(i => !i.ParticipationCount).sortBy('MeetingStartTime').reverse().value(),
            }
        ],
    });

    return makeHTMLResponse(200, response, acceptEncoding);
};
