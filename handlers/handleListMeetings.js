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
        TIMEZONE,
        git_version,
      } = require('./helpers.js');

const { DateTime, Duration } = require('luxon');
DateTime.DATETIME_CLEAR = DATETIME_CLEAR;

const AWS = require('aws-sdk');

const listMeetingsTemplate = pug.compileFile('views/list-meetings.pug');

const fetchDataFromDynamo = async (numDays) => {
    // Stryker disable StringLiteral,ObjectLiteral: This query is correct but won't be tested due to mocking
    const statement = `SELECT MeetingID,
                              MeetingTitle,
                              MeetingStartTime,
                              MeetingDuration,
                              ParticipationCount,
                              LastUpdatedAt
                        FROM ${DB_TABLE}."MeetingID-LastUpdatedAt"
                        WHERE LastUpdatedAt > '${DateTime.utc().minus({ days: numDays }).toISO()}'`;
    // Stryker enable StringLiteral,ObjectLiteral

    let nextToken = undefined;
    let items = [];
    do {
        const raw = await dynamoDB.executeStatement({ Statement: statement, nextToken }).promise();
        items = [...items, ...raw.Items];
        nextToken = raw.nextToken;
    } while(nextToken);

    return items;
};
module.exports._fetchDataFromDynamo = fetchDataFromDynamo;

const preProcessResults = (items) => {
    return _(items)
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
            return {
                ...sum,
                [`${i.MeetingID}`]: updated,
            };
        }, {});
};
module.exports._preProcessResults = preProcessResults;

module.exports.handleListMeetings = async (event) => {
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

    const acceptEncoding = event.headers && event.headers[ACCEPT_ENCODING];

    const numDays = event.queryStringParameters && event.queryStringParameters.numDays && parseInt(event.queryStringParameters.numDays) || 7;

    const items = await fetchDataFromDynamo(numDays);

    const results = await preProcessResults(items);

    const response = listMeetingsTemplate({
        DateTime,
        TIMEZONE,
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
