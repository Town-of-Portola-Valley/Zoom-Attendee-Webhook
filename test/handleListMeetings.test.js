'use strict';

const { ConnectContactLens } = require('aws-sdk');
const { DateTime, Duration } = require('luxon');
const _ = require('lodash');

// Fish out private helper methods
const hLM = require('../handlers/handleListMeetings');
const fetchDataFromDynamo = hLM._fetchDataFromDynamo;
const preProcessResults = hLM._preProcessResults;
const { handleListMeetings } = hLM;

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
            expect.assertions(2);
            const oneEndedMeeting = require('./fixtures/one-ended-meeting.json');
            const results = preProcessResults(oneEndedMeeting);
            expect(results).toStrictEqual({
                [123]: {
                    MeetingTitle: 'Meeting Title',
                    MeetingID: 123,
                    MeetingStartTime: expect.any(DateTime),
                    MeetingDuration: expect.any(Duration),
                    ParticipationCount: 0,
                    LastUpdatedAt: expect.any(DateTime),
                },
            });
            expect(results[123].MeetingDuration.valueOf()).toBeGreaterThan(0);
        });

        it('two items', async () => {
            expect.assertions(2);
            const oneEndedMeeting = require('./fixtures/one-ended-meeting.json');
            const oneRunningMeeting = require('./fixtures/one-running-meeting.json');
            const results = preProcessResults([...oneEndedMeeting, ...oneRunningMeeting]);
            expect(results).toStrictEqual({
                [123]: {
                    MeetingTitle: 'Meeting Title',
                    MeetingID: 123,
                    MeetingStartTime: expect.any(DateTime),
                    MeetingDuration: expect.any(Duration),
                    ParticipationCount: 0,
                    LastUpdatedAt: expect.any(DateTime),
                },
                [321]: {
                    MeetingTitle: 'Other Meeting Title',
                    MeetingID: 321,
                    MeetingStartTime: expect.any(DateTime),
                    MeetingDuration: expect.any(Duration),
                    ParticipationCount: 1,
                    LastUpdatedAt: expect.any(DateTime),
                },
            });
            expect(results[321].MeetingDuration.valueOf()).toBeGreaterThan(0);
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
                    MeetingTitle: 'Meeting Title',
                    MeetingID: 123,
                    MeetingStartTime: expect.any(DateTime),
                    MeetingDuration: expect.any(Duration),
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

            const result = handleListMeetings();
            const expected = await makeHTMLResponse(500, INTERNAL_SERVER_ERROR);

            await expect(result).resolves.toStrictEqual(expected);
        });

        it('should respond correctly to keep-alive pings', async () => {
            expect.assertions(3);

            const event = require('./fixtures/keep-alive.json');
            const result = handleListMeetings(event);

            await expect(result).resolves.toStrictEqual(expect.objectContaining({
                headers: expect.objectContaining({
                    'X-Git-Version': expect.stringContaining('gitVersion'),
                }),
                statusCode: expect.any(Number),
            }));
            expect((await result).statusCode).toBeGreaterThanOrEqual(200);
            expect((await result).statusCode).toBeLessThan(300);
        });

        it('should respond correctly when passed no headers', async () => {
            expect.assertions(1);

            const event = {};
            const result = handleListMeetings(event);
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
            const result = await handleListMeetings(event);
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

    describe('numDays parameter', () => {
        it('should use 7 days when no param passed', async () => {
            expect.assertions(1);
            const event = { headers: {} };
            jest.spyOn(dynamoDB, 'executeStatement')
                .mockReturnValueOnce({
                    promise: async () => ({
                        Items: [],
                    }),
                });
            const result = await handleListMeetings(event);
            expect(result).toStrictEqual({
                body: expect.stringContaining('value="7"'),
                statusCode: 200,
                headers: expect.any(Object),
                isBase64Encoded: false,
            });
        });

        it('should use 14 days when passed 14', async () => {
            expect.assertions(1);
            const event = { headers: {}, queryStringParameters: { numDays: '14' } };
            jest.spyOn(dynamoDB, 'executeStatement')
                .mockReturnValueOnce({
                    promise: async () => ({
                        Items: [],
                    }),
                });
            const result = await handleListMeetings(event);
            expect(result).toStrictEqual({
                body: expect.stringContaining('value="14"'),
                statusCode: 200,
                headers: expect.any(Object),
                isBase64Encoded: false,
            });
        });
    });

    describe('working request', () => {
        it('no meetings should generate empty list', async () => {
            expect.assertions(1);
            const event = { headers: {} };
            jest.spyOn(dynamoDB, 'executeStatement')
                .mockReturnValueOnce({
                    promise: async () => ({
                        Items: [],
                    }),
                });
            const result = await handleListMeetings(event);
            expect(result).toStrictEqual({
                body: expect.stringMatching(/None.*None/s),
                statusCode: 200,
                headers: expect.any(Object),
                isBase64Encoded: false,
            });
        });

        it('one ended meeting should generate empty list of actives', async () => {
            expect.assertions(1);
            const event = { headers: {} };
            const oneEndedMeeting = require('./fixtures/one-ended-meeting.json');
            jest.spyOn(dynamoDB, 'executeStatement')
                .mockReturnValueOnce({
                    promise: async () => ({
                        Items: oneEndedMeeting,
                    })
                });
            const result = await handleListMeetings(event);
            expect(result).toStrictEqual({
                body: expect.stringMatching(/Active Meetings.*None.*Ended Meetings.*meeting\/123.*Meeting Title/s),
                statusCode: 200,
                headers: expect.any(Object),
                isBase64Encoded: false,
            });
        });

        it('two active and two ended should generate lists in order', async () => {
            expect.assertions(3);
            const event = { headers: {} };
            const oneEndedMeeting = require('./fixtures/one-ended-meeting.json');
            const oneRunningMeeting = require('./fixtures/one-running-meeting.json');
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
            const result = await handleListMeetings(event);
            expect(result).toStrictEqual({
                body: expect.stringMatching(/Active Meetings.*Other Meeting Title.*Later Running.*Ended Meetings.*Later Ended.*Meeting Title/s),
                statusCode: 200,
                headers: expect.any(Object),
                isBase64Encoded: false,
            });
            // Make sure active meetings are only active and ended meetings only ended
            expect(result.body).not.toStrictEqual(expect.stringMatching(/Ended Meetings.*Later Running/s));
            expect(result.body).not.toStrictEqual(expect.stringMatching(/Later Ending.*Ended Meetings/s));
        });
    });
});
