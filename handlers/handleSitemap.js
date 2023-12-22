'use strict';

const logger = require('@hughescr/logger').logger;
const _ = require('lodash');
const pug = require('pug');

const {
    makeHTMLResponse,
    makeXMLResponse,
    dynamoDB,
    NO_EVENT_RECEIVED,
    INTERNAL_SERVER_ERROR,
    ACCEPT_ENCODING,
    DB_TABLE,
} = require('./helpers.js');

const { DateTime } = require('luxon');

const { unmarshall } = require('@aws-sdk/util-dynamodb');

const sitemapTemplate = pug.compileFile('views/sitemap.pug');

const fetchDataFromDynamo = async () => {
    // Stryker disable StringLiteral,ObjectLiteral: This query is correct but won't be tested due to mocking
    const statement = `SELECT MeetingID,
                              ParticipationCount,
                              LastUpdatedAt
                        FROM ${DB_TABLE}."MeetingID-LastUpdatedAt"`;
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
        .map(unmarshall)
        .reduce((sum, i) => {
            const previous_last_updated = sum[i.MeetingID] && sum[i.MeetingID].LastUpdatedAt || DateTime.fromISO(i.LastUpdatedAt);
            const updated = {
                ...sum[i.MeetingID],
                MeetingID: i.MeetingID,
                LastUpdatedAt: DateTime.max(previous_last_updated, DateTime.fromISO(i.LastUpdatedAt)),
            };
            updated.ParticipationCount = (updated.ParticipationCount || 0) + i.ParticipationCount;
            return {
                ...sum,
                [`${i.MeetingID}`]: updated,
            };
        }, {});
};
module.exports._preProcessResults = preProcessResults;

module.exports.handleSitemap = async (event) => {
    if(!event) {
        logger.error(NO_EVENT_RECEIVED);

        return makeHTMLResponse(500, INTERNAL_SERVER_ERROR);
    }

    if(!event.headers) {
        logger.error('No headers were in the event', event);

        return makeHTMLResponse(500, INTERNAL_SERVER_ERROR);
    }

    const acceptEncoding = event.headers[ACCEPT_ENCODING];

    const items = await fetchDataFromDynamo();

    const results = await preProcessResults(items);

    const response = sitemapTemplate({
        lastUpdated: DateTime.now(),
        baseURL: `https://${event.headers.host}/`,
        meetings: {
            ongoing: _(results).map().filter('ParticipationCount').value(),
            ended: _(results).map().filter(i => !i.ParticipationCount).value(),
        }
    });

    return makeXMLResponse(200, response, acceptEncoding);
};
