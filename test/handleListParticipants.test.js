'use strict';

const { DateTime, Duration } = require('luxon');

// Fish out private helper methods
const hLP = require('../handlers/handleListParticipants');
const sortJoinLeaveTimes = hLP._sortJoinLeaveTimes;
const activeBarWidth = hLP._activeBarWidth;
const durationToPercentage = hLP._durationToPercentage;
const participantProgressData = hLP._participantProgressData;
const preProcessResults = hLP._preProcessResults;
const { handleListParticipants } = hLP;

const { dynamoDB, makeHTMLResponse, INTERNAL_SERVER_ERROR } = require('../handlers/helpers');

describe('listParticipants', () => {
    describe('sortJoinLeaveTimes', () => {
        it('single join works', async () => {
            expect.assertions(1);

            const oneHourAgo = DateTime.now().minus({ hours: 1 });
            const result = await sortJoinLeaveTimes({
                JoinTimes: [oneHourAgo],
            }, oneHourAgo);
            // eslint-disable-next-line jest/prefer-strict-equal -- Compare dates converted to strings
            expect(result).toEqual([{ time: oneHourAgo, state: 0 }, { time: oneHourAgo, state: 1 }]);
        });

        it('single leave works', async () => {
            expect.assertions(1);

            const oneHourAgo = DateTime.now().minus({ hours: 1 });
            const result = await sortJoinLeaveTimes({
                LeaveTimes: [oneHourAgo],
            }, oneHourAgo);
            // eslint-disable-next-line jest/prefer-strict-equal -- Compare dates converted to strings
            expect(result).toEqual([{ time: oneHourAgo, state: 0 }, { time: oneHourAgo, state: 0 }]);
        });

        it('simultaneous join leave works', async () => {
            expect.assertions(1);

            const oneHourAgo = DateTime.now().minus({ hours: 1 });
            const result = await sortJoinLeaveTimes({
                JoinTimes: [oneHourAgo],
                LeaveTimes: [oneHourAgo],
            }, oneHourAgo);
            // eslint-disable-next-line jest/prefer-strict-equal -- Compare dates converted to strings
            expect(result).toEqual([{ time: oneHourAgo, state: 0 }, { time: oneHourAgo, state: 1 }, { time: oneHourAgo, state: 0 }]);
        });

        it('join after leave works', async () => {
            expect.assertions(1);

            const oneHourAgo = DateTime.now().minus({ hours: 1 });
            const twoHoursAgo = DateTime.now().minus({ hours: 2 });
            const threeHoursAgo = DateTime.now().minus({ hours: 3 });
            const fourHoursAgo = DateTime.now().minus({ hours: 4 });

            const result = await sortJoinLeaveTimes({
                JoinTimes: [fourHoursAgo, twoHoursAgo],
                LeaveTimes: [threeHoursAgo, oneHourAgo],
            }, fourHoursAgo);
            // eslint-disable-next-line jest/prefer-strict-equal -- Compare dates converted to strings
            expect(result).toEqual([{ time: fourHoursAgo, state: 0 },
                                   { time: fourHoursAgo, state: 1 },
                                   { time: threeHoursAgo, state: 0 },
                                   { time: twoHoursAgo, state: 1 },
                                   { time: oneHourAgo, state: 0 }]);
        });
    });

    describe('activeBarWidth', () => {
        it('meeting ended', async () => {
            expect.assertions(1);

            const now = DateTime.now();
            const twoHoursAgo = now.minus({ hours: 2 });
            const oneHour = Duration.fromObject({ hours: 1 });
            const result = await activeBarWidth(twoHoursAgo,
                                                oneHour,
                                                now);
            expect(result).toBe(99);
        });

        it('95% duration exceeded', async () => {
            expect.assertions(1);

            const now = DateTime.now();
            const twoHoursAgo = now.minus({ hours: 2 });
            const oneHour = Duration.fromObject({ hours: 1 });
            const result = await activeBarWidth(twoHoursAgo,
                                                oneHour,
                                                undefined);
            expect(result).toBeCloseTo(95);
        });

        it('95% duration not reached', async () => {
            expect.assertions(1);

            const twoHoursAgo = DateTime.now().minus({ hours: 2 });
            const threeHours = Duration.fromObject({ hours: 3 });
            const result = await activeBarWidth(twoHoursAgo,
                                                threeHours,
                                                undefined);
            expect(result).toBeCloseTo(100);
        });

        it('95% duration on the nose', async () => {
            expect.assertions(1);

            const now = DateTime.now();
            const longAgo = now.minus({ hours: 95 });
            const longTime = Duration.fromObject({ hours: 100 });
            const result = await activeBarWidth(longAgo,
                                                longTime,
                                                undefined);
            expect(result).toBeCloseTo(95);
        });
    });

    describe('durationToPercentage', () => {
        it('half hour in hour long ended meeting', async () => {
            expect.assertions(1);

            const now = DateTime.now();
            const halfHour = Duration.fromObject({ minutes: 30 });
            const oneHourAgo = now.minus({ hours: 1 });
            const longTime = Duration.fromObject({ hours: 30 });
            const result = await durationToPercentage(halfHour,
                                                  oneHourAgo,
                                                  longTime,
                                                  now);
            expect(result).toBeCloseTo(1 / 2 * 99);
        });

        it('95% duration not reached in regulation', async () => {
            expect.assertions(1);

            const now = DateTime.now();
            const oneHourAgo = now.minus({ hours: 1 });
            const oneHour = Duration.fromObject({ hours: 1 });
            const twoHours = Duration.fromObject({ hours: 2 });
            const result = await durationToPercentage(oneHour,
                                                  oneHourAgo,
                                                  twoHours,
                                                  undefined);
            expect(result).toBeCloseTo(1 / 2 * 100);
        });

        it('95% duration exceeded in regulation', async () => {
            expect.assertions(1);

            const now = DateTime.now();
            const oneHourAgo = now.minus({ hours: 1 });
            const oneHour = Duration.fromObject({ hours: 1 });
            const result = await durationToPercentage(oneHour,
                                                  oneHourAgo,
                                                  oneHour,
                                                  undefined);
            expect(result).toBeCloseTo(95);
        });

        it('95% duration on the nose in regulation', async () => {
            expect.assertions(1);

            const now = DateTime.now();
            const longAgo = now.minus({ hours: 95 });
            const ninetyFivePercentTime = Duration.fromObject({ hours: 95 });
            const longTime = Duration.fromObject({ hours: 100 });
            const result = await durationToPercentage(ninetyFivePercentTime,
                                                  longAgo,
                                                  longTime,
                                                  undefined);
            expect(result).toBeCloseTo(95);
        });

        it('live in overtime', async () => {
            expect.assertions(1);

            const now = DateTime.now();
            const oneHourAgo = now.minus({ hours: 1 });
            const oneHour = Duration.fromObject({ hours: 1 });
            const halfHour = Duration.fromObject({ minutes: 30 });
            const result = await durationToPercentage(oneHour,
                                                  oneHourAgo,
                                                  halfHour,
                                                  undefined);
            expect(result).toBeCloseTo(95);
        });
    });

    describe('participantProgressData', () => {
        it('single join', async () => {
            expect.assertions(1);

            const oneHourAgo = DateTime.now().minus({ hours: 1 });
            const result = await participantProgressData({
                                                            JoinTimes: [oneHourAgo],
                                                         },
                                                         oneHourAgo,
                                                         Duration.fromObject({ hours: 1 }),
                                                         undefined);
            expect(result).toStrictEqual(expect.arrayContaining([
                expect.objectContaining({
                    percent: 0,
                    present: false,
                }),
                expect.objectContaining({
                    percent: expect.closeTo(95),
                    present: true,
                    tooltip: expect.stringMatching(/Entered: \d?\d:\d\d [AP]M P[SD]T/),
                }),
            ]));
        });

        it('single join half way', async () => {
            expect.assertions(1);

            const oneHourAgo = DateTime.now().minus({ hours: 1 });
            const twoHoursAgo = DateTime.now().minus({ hours: 2 });
            const result = await participantProgressData({
                                                            JoinTimes: [oneHourAgo],
                                                         },
                                                         twoHoursAgo,
                                                         Duration.fromObject({ hours: 2 }),
                                                         undefined);
            expect(result).toStrictEqual(expect.arrayContaining([
                expect.objectContaining({
                    present: false,
                    percent: expect.closeTo(1 / 2 * 95),
                }),
                expect.objectContaining({
                    present: true,
                    percent: expect.closeTo(1 / 2 * 95),
                    tooltip: expect.stringMatching(/Entered: \d?\d:\d\d [AP]M P[SD]T/),
                }),
            ]));
        });

        it('join then leave', async () => {
            expect.assertions(1);

            const oneHourAgo = DateTime.now().minus({ hours: 1 });
            const twoHoursAgo = DateTime.now().minus({ hours: 2 });
            const result = await participantProgressData({
                                                            JoinTimes: [twoHoursAgo],
                                                            LeaveTimes: [oneHourAgo],
                                                         },
                                                         twoHoursAgo,
                                                         Duration.fromObject({ hours: 2 }),
                                                         undefined);
            expect(result).toStrictEqual(expect.arrayContaining([
                expect.objectContaining({
                    present: false,
                    percent: 0,
                }),
                expect.objectContaining({
                    present: true,
                    percent: expect.closeTo(1 / 2 * 95),
                    tooltip: expect.stringMatching(/\d?\d:\d\d [AP]M - \d?\d:\d\d [AP]M P[SD]T/),
                }),
                expect.objectContaining({
                    present: false,
                    percent: expect.closeTo(1 / 2 * 95),
                }),
            ]));
        });

        it('join then leave then join', async () => {
            expect.assertions(1);

            const now = DateTime.now();
            const oneHourAgo = now.minus({ hours: 1 });
            const twoHoursAgo = now.minus({ hours: 2 });
            const threeHoursAgo = now.minus({ hours: 3 });
            const result = await participantProgressData({
                                                            JoinTimes: [threeHoursAgo, oneHourAgo],
                                                            LeaveTimes: [twoHoursAgo],
                                                         },
                                                         threeHoursAgo,
                                                         Duration.fromObject({ hours: 3 }),
                                                         undefined);
            expect(result).toStrictEqual(expect.arrayContaining([
                expect.objectContaining({
                    present: false,
                    percent: 0,
                }),
                expect.objectContaining({
                    present: true,
                    percent: expect.closeTo(1 / 3 * 95),
                    tooltip: expect.stringMatching(/\d?\d:\d\d [AP]M - \d?\d:\d\d [AP]M P[SD]T/),
                }),
                expect.objectContaining({
                    present: false,
                    percent: expect.closeTo(1 / 3 * 95),
                }),
                expect.objectContaining({
                    present: true,
                    percent: expect.closeTo(1 / 3 * 95),
                    tooltip: expect.stringMatching(/Entered: \d?\d:\d\d [AP]M P[SD]T/),
                }),
            ]));
        });

        it('only leave', async () => {
            expect.assertions(1);

            const now = DateTime.now();
            const oneHourAgo = now.minus({ hours: 1 });
            const result = await participantProgressData({
                                                            LeaveTimes: [oneHourAgo],
                                                         },
                                                         oneHourAgo,
                                                         Duration.fromObject({ hours: 3 }),
                                                         undefined);
            expect(result).toStrictEqual(expect.arrayContaining([
                expect.objectContaining({
                    present: false,
                    percent: 0,
                }),
                expect.objectContaining({
                    present: false,
                    percent: 0,
                }),
            ]));
        });
    });

    describe('fetchDataFromDynamo', () => {
        beforeEach(() => {
            jest.clearAllMocks();
        });

        it('single page', async () => {
            expect.assertions(3);
            jest.spyOn(dynamoDB, 'executeStatement')
                .mockReturnValueOnce({
                    promise: async () => ({
                        Items: [1],
                    }),
                });
            const results = await hLP._fetchDataFromDynamo(123);

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
            const results = await hLP._fetchDataFromDynamo(123);

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
            expect.assertions(2);
            const results = preProcessResults(123, []);

            expect(results).toStrictEqual(expect.objectContaining({
                MeetingTitle: expect.stringContaining('does not exist'),
                MeetingID: 123,
                MeetingStartTime: expect.any(DateTime),
                MeetingDuration: expect.any(Duration),
                ParticipantCount: 0,
                results: {},
            }));
            expect(results.MeetingDuration.valueOf()).toBe(0);
        });

        it('one item', async () => {
            expect.assertions(2);
            const singleLeftItemDynamo = require('./fixtures/single-person-left-dynamo.json');
            const results = preProcessResults(123, [singleLeftItemDynamo]);
            expect(results).toStrictEqual(expect.objectContaining({
                MeetingTitle: 'Meeting Title',
                MeetingID: '123',
                MeetingStartTime: expect.any(DateTime),
                MeetingDuration: expect.any(Duration),
                ParticipantCount: 1,
                results: {
                    offline: [
                        {
                            ParticipantName: 'Joe Blow',
                            ParticipantEmail: 'someuser@example.com',
                            JoinTimes: [expect.any(DateTime)],
                            LeaveTimes: [expect.any(DateTime)],
                            JoinTime: expect.any(DateTime),
                            LeaveTime: expect.any(DateTime),
                            ParticipantOnline: 'offline',
                        },
                    ],
                },
            }));
            expect(results.MeetingDuration.valueOf()).toBeGreaterThan(0);
        });
    });

    describe('basics', () => {
        it('should detect missing events', async () => {
            expect.assertions(1);

            const result = handleListParticipants();
            const expected = await makeHTMLResponse(500, INTERNAL_SERVER_ERROR);

            await expect(result).resolves.toStrictEqual(expected);
        });

        it('should respond correctly to keep-alive pings', async () => {
            expect.assertions(3);

            const event = require('./fixtures/keep-alive.json');
            const result = handleListParticipants(event);

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
            const result = handleListParticipants(event);
            const expected = await makeHTMLResponse(500, INTERNAL_SERVER_ERROR);

            await expect(result).resolves.toStrictEqual(expected);
        });

        it('should respond correctly when passed headers but no pathParameters', async () => {
            expect.assertions(1);

            const event = { headers: {} };
            const result = handleListParticipants(event);
            const expected = await makeHTMLResponse(500, INTERNAL_SERVER_ERROR);

            await expect(result).resolves.toStrictEqual(expected);
        });

        it('should respond correctly when passed pathParameters but no meetingID', async () => {
            expect.assertions(1);

            const event = { headers: {}, pathParameters: {} };
            const result = handleListParticipants(event);
            const expected = await makeHTMLResponse(500, INTERNAL_SERVER_ERROR);

            await expect(result).resolves.toStrictEqual(expected);
        });
    });

    describe('working request', () => {
        it('non-existent meeting should display error page', async () => {
            expect.assertions(1);
            const event = { headers: {}, pathParameters: { meeting_id: 123 } };
            jest.spyOn(dynamoDB, 'executeStatement')
                .mockReturnValueOnce({
                    promise: async () => ({
                        Items: [],
                    }),
                });
            const result = await handleListParticipants(event);
            expect(result).toStrictEqual({
                body: expect.stringContaining('meeting does not exist'),
                statusCode: 200,
                headers: expect.any(Object),
                isBase64Encoded: false,
            });
        });

        it('ended meeting should show users', async () => {
            expect.assertions(4);
            const event = { headers: {}, pathParameters: { meeting_id: 123 } };
            const singleLeftItemDynamo = require('./fixtures/single-person-left-dynamo.json');
            jest.spyOn(dynamoDB, 'executeStatement')
                .mockReturnValueOnce({
                    promise: async () => ({
                        Items: [singleLeftItemDynamo],
                    }),
                });
            const result = await handleListParticipants(event);
            expect(result).toStrictEqual({
                body: expect.stringContaining('Meeting Title'),
                statusCode: 200,
                headers: expect.any(Object),
                isBase64Encoded: false,
            });
            expect(result.body).toStrictEqual(expect.stringContaining('Total participants: 1'));
            expect(result.body).toStrictEqual(expect.stringContaining('Ended:'));
            expect(result.body).toStrictEqual(expect.stringMatching(/Online.*None.*Left the meeting.*Joe Blow/));
        });

        it('running meeting should show users', async () => {
            expect.assertions(5);
            const event = { headers: {}, pathParameters: { meeting_id: 123 } };
            const singleLeftItemDynamo = require('./fixtures/single-person-left-dynamo.json');
            const singleHereItemDynamo = require('./fixtures/single-person-still-in-dynamo.json');
            jest.spyOn(dynamoDB, 'executeStatement')
                .mockReturnValueOnce({
                    promise: async () => ({
                        Items: [singleLeftItemDynamo, singleHereItemDynamo],
                    }),
                });
            const result = await handleListParticipants(event);
            expect(result).toStrictEqual({
                body: expect.stringContaining('Meeting Title'),
                statusCode: 200,
                headers: expect.any(Object),
                isBase64Encoded: false,
            });
            expect(result.body).toStrictEqual(expect.stringContaining('Total participants: 2'));
            expect(result.body).toStrictEqual(expect.stringContaining('Currently: 1 participant'));
            expect(result.body).toStrictEqual(expect.stringMatching(/Online.*?Jane Doe/));
            expect(result.body).toStrictEqual(expect.stringMatching(/Left the meeting.*?Joe Blow/));
        });
    });

    it('meeting should with leaver no joins should work', async () => {
        expect.assertions(4);
        const event = { headers: {}, pathParameters: { meeting_id: 123 } };
        const singleLeftNoJoinItemDynamo = require('./fixtures/single-person-left-no-join-dynamo.json');
        jest.spyOn(dynamoDB, 'executeStatement')
            .mockReturnValueOnce({
                promise: async () => ({
                    Items: [singleLeftNoJoinItemDynamo],
                }),
            });
        const result = await handleListParticipants(event);
        expect(result).toStrictEqual({
            body: expect.stringContaining('Meeting Title'),
            statusCode: 200,
            headers: expect.any(Object),
            isBase64Encoded: false,
        });
        expect(result.body).toStrictEqual(expect.stringContaining('Total participants: 1'));
        expect(result.body).toStrictEqual(expect.stringContaining('Ended:'));
        expect(result.body).toStrictEqual(expect.stringMatching(/Left the meeting.*?Joe Blow/));
    });
});
