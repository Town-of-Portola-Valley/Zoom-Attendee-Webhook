'use strict';

const { DateTime } = require('luxon');
const _ = require('lodash');

// Fish out private helper methods
const hSM = require('../handlers/handleSitemap');
const fetchDataFromDynamo = hSM._fetchDataFromDynamo;
const preProcessResults = hSM._preProcessResults;
const { handleSitemap } = hSM;

const { dynamoDB, makeHTMLResponse, INTERNAL_SERVER_ERROR } = require('../handlers/helpers');

describe('listMeetings', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('fetchDataFromDynamo', () => {
        it('single page', async () => {
            expect.assertions(3);
            jest.spyOn(dynamoDB, 'executeStatement')
                .mockReturnValueOnce({
                    promise: async () => ({
                        Items: [1],
                    }),
                });
            const results = await fetchDataFromDynamo(7);

            expect(results).toStrictEqual([1]);
            expect(dynamoDB.executeStatement).toHaveBeenCalledTimes(1);
            expect(dynamoDB.executeStatement).toHaveBeenNthCalledWith(1, expect.objectContaining({
                Statement: expect.stringContaining('SELECT'),
                nextToken: undefined,
            }));
        });

        it('multiple pages', async () => {
            expect.assertions(4);
            jest.spyOn(dynamoDB, 'executeStatement')
                .mockReturnValueOnce({
                    promise: async () => ({
                        Items: [1],
                        nextToken: 'abc',
                    }),
                })
                .mockReturnValueOnce({
                    promise: async () => ({
                        Items: [2],
                    }),
                });
            const results = await fetchDataFromDynamo(7);

            expect(results).toStrictEqual([1, 2]);
            expect(dynamoDB.executeStatement).toHaveBeenCalledTimes(2);
            expect(dynamoDB.executeStatement).toHaveBeenNthCalledWith(1, expect.objectContaining({
                Statement: expect.stringContaining('SELECT'),
                nextToken: undefined,
            }));
            expect(dynamoDB.executeStatement).toHaveBeenNthCalledWith(2, expect.objectContaining({
                Statement: expect.stringContaining('SELECT'),
                nextToken: 'abc',
            }));
        });
    });

    describe('preProcessResults', () => {
        it('no items', async () => {
            expect.assertions(1);
            const results = preProcessResults([]);

            expect(results).toStrictEqual({});
        });

        it('one item', async () => {
            expect.assertions(1);
            const oneEndedMeeting = require('./fixtures/one-ended-meeting.json');
            const results = preProcessResults(oneEndedMeeting);
            expect(results).toStrictEqual({
                [123]: {
                    MeetingID: 123,
                    ParticipationCount: 0,
                    LastUpdatedAt: expect.any(DateTime),
                },
            });
        });

        it('two items', async () => {
            expect.assertions(1);
            const oneEndedMeeting = require('./fixtures/one-ended-meeting.json');
            const oneRunningMeeting = require('./fixtures/one-running-meeting.json');
            const results = preProcessResults([...oneEndedMeeting, ...oneRunningMeeting]);
            expect(results).toStrictEqual({
                [123]: {
                    MeetingID: 123,
                    ParticipationCount: 0,
                    LastUpdatedAt: expect.any(DateTime),
                },
                [321]: {
                    MeetingID: 321,
                    ParticipationCount: 1,
                    LastUpdatedAt: expect.any(DateTime),
                },
            });
        });

        it('three items same meeting differing LastUpdatedAt', async () => {
            expect.assertions(2);
            const oneEndedMeeting = require('./fixtures/one-ended-meeting.json');
            const secondEndedMeeting = _.cloneDeep(oneEndedMeeting);
            const thirdEndedMeeting = _.cloneDeep(oneEndedMeeting);
            oneEndedMeeting[0].LastUpdatedAt.S = '2022-01-01T00:00:00Z';
            secondEndedMeeting[0].LastUpdatedAt.S = '2022-01-03T00:00:00Z';
            thirdEndedMeeting[0].LastUpdatedAt.S = '2022-01-02T00:00:00Z';
            const params = [...oneEndedMeeting, ...secondEndedMeeting, ...thirdEndedMeeting];
            const results = preProcessResults(params);
            expect(results).toStrictEqual({
                [123]: {
                    MeetingID: 123,
                    ParticipationCount: 0,
                    LastUpdatedAt: expect.any(DateTime),
                },
            });
            expect(results[123].LastUpdatedAt).toStrictEqual(DateTime.fromISO('2022-01-03T00:00:00Z'));
        });
    });

    describe('basics', () => {
        it('should detect missing events', async () => {
            expect.assertions(1);

            const result = handleSitemap();
            const expected = await makeHTMLResponse(500, INTERNAL_SERVER_ERROR);

            await expect(result).resolves.toStrictEqual(expected);
        });

        it('should respond correctly when passed no headers', async () => {
            expect.assertions(1);

            const event = {};
            const result = handleSitemap(event);
            const expected = await makeHTMLResponse(500, INTERNAL_SERVER_ERROR);

            await expect(result).resolves.toStrictEqual(expected);
        });

        it('should encode when asked to encode', async () => {
            expect.assertions(1);
            const event = { headers: { 'accept-encoding': 'br' } };
            jest.spyOn(dynamoDB, 'executeStatement')
                .mockReturnValueOnce({
                    promise: async () => ({
                        Items: [],
                    }),
                });
            const result = await handleSitemap(event);
            expect(result).toStrictEqual({
                body: expect.stringMatching(/=$/),
                statusCode: 200,
                headers: expect.objectContaining({
                    'Content-Encoding': 'br',
                }),
                isBase64Encoded: true,
            });
        });
    });

    describe('working request', () => {
        it('no meetings should generate empty list', async () => {
            expect.assertions(1);
            const event = { headers: { host: 'somefoo' } };
            jest.spyOn(dynamoDB, 'executeStatement')
                .mockReturnValueOnce({
                    promise: async () => ({
                        Items: [],
                    }),
                });
            const result = await handleSitemap(event);
            expect(result).toStrictEqual({
                body: expect.stringMatching(/somefoo/),
                statusCode: 200,
                headers: expect.any(Object),
                isBase64Encoded: false,
            });
        });

        it('one ended meeting should generate an entry', async () => {
            expect.assertions(1);
            const event = { headers: { host: 'somefoo' } };
            const oneEndedMeeting = require('./fixtures/one-ended-meeting.json');
            jest.spyOn(dynamoDB, 'executeStatement')
                .mockReturnValueOnce({
                    promise: async () => ({
                        Items: oneEndedMeeting,
                    })
                });
            const result = await handleSitemap(event);
            expect(result).toStrictEqual({
                body: expect.stringMatching(/somefoo\/meeting\/123/),
                statusCode: 200,
                headers: expect.any(Object),
                isBase64Encoded: false,
            });
        });

        it('two active and two ended should generate list with correct changefreqs', async () => {
            expect.assertions(5);
            const event = { headers: { host: 'somefoo' } };
            const oneEndedMeeting = require('./fixtures/one-ended-meeting.json'); // meeting 123
            const oneRunningMeeting = require('./fixtures/one-running-meeting.json'); // meeting 321
            const secondEndedMeeting = _.cloneDeep(oneEndedMeeting);
            secondEndedMeeting[0].MeetingStartTime.S = DateTime.fromISO(secondEndedMeeting[0].MeetingStartTime.S).plus({ hours: 1 }).toISO();
            secondEndedMeeting[0].MeetingTitle.S = 'Later Ended';
            secondEndedMeeting[0].MeetingID.N = '333';
            const secondRunningMeeting = _.cloneDeep(oneRunningMeeting);
            secondRunningMeeting[0].MeetingStartTime.S = DateTime.fromISO(secondEndedMeeting[0].MeetingStartTime.S).plus({ hours: 1 }).toISO();
            secondRunningMeeting[0].MeetingTitle.S = 'Later Running';
            secondRunningMeeting[0].MeetingID.N = '111';
            jest.spyOn(dynamoDB, 'executeStatement')
                .mockReturnValueOnce({
                    promise: async () => ({
                        Items: [...oneEndedMeeting, ...oneRunningMeeting, ...secondEndedMeeting, ...secondRunningMeeting],
                    })
                });
            const result = await handleSitemap(event);
            expect(result).toStrictEqual({
                body: expect.stringMatching(/somefoo\/meeting\/123.*changefreq>never.*somefoo\/meeting\/333.*changefreq>never.*somefoo\/meeting\/111.*changefreq>always.*somefoo\/meeting\/321.*changefreq>always/s),
                statusCode: 200,
                headers: expect.any(Object),
                isBase64Encoded: false,
            });
            // Make sure each entry is only there once
            expect(result.body).not.toMatch(/somefoo\/meeting\/123.*somefoo\/meeting\/123/);
            expect(result.body).not.toMatch(/somefoo\/meeting\/321.*somefoo\/meeting\/321/);
            expect(result.body).not.toMatch(/somefoo\/meeting\/111.*somefoo\/meeting\/111/);
            expect(result.body).not.toMatch(/somefoo\/meeting\/333.*somefoo\/meeting\/333/);
        });
    });
});
