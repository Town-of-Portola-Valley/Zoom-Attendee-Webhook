'use strict';

const { DateTime, Duration } = require('luxon');

// Fish out private helper methods
const hLP = require('../handlers/handleListParticipants');
const sortJoinLeaveTimes = hLP._sortJoinLeaveTimes;
const activeBarWidth = hLP._activeBarWidth;
const durationToPercentage = hLP._durationToPercentage;
const participantProgressData = hLP._participantProgressData;
const preProcessResults = hLP._preProcessResults;

const { dynamoDB } = require('../handlers/helpers');

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
                    tooltip: expect.stringMatching(/\d?\d:\d\d [AP]M P[SD]T - \d?\d:\d\d [AP]M P[SD]T/),
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
                    tooltip: expect.stringMatching(/\d?\d:\d\d [AP]M P[SD]T - \d?\d:\d\d [AP]M P[SD]T/),
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
        it('single page', async () => {
            expect.assertions(1);
            jest.spyOn(dynamoDB, 'executeStatement')
                .mockReturnValueOnce({
                    promise: async () => ({
                        Items: [1],
                    }),
                });
            const results = await hLP._fetchDataFromDynamo(123);

            expect(results).toStrictEqual([1]);
        });

        it('multiple pages', async () => {
            expect.assertions(1);
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
        });
    });

    describe('preProcessResults', () => {
        it('no items', async () => {
            expect.assertions(1);
            const results = preProcessResults(123, []);

            expect(results).toStrictEqual(expect.objectContaining({
                MeetingTitle: expect.stringContaining('does not exist'),
                MeetingID: 123,
                MeetingStartTime: expect.any(DateTime),
                MeetingDuration: Duration.fromObject({ minutes: 0 }),
                ParticipantCount: 0,
                results: {},
            }));
        });

        it('one item', async () => {
            expect.assertions(1);
            const singleItemDynamo = require('./fixtures/single-item-dynamo.json');
            const results = preProcessResults(123, [singleItemDynamo]);

            expect(results).toStrictEqual(expect.objectContaining({
                MeetingTitle: 'Meeting Title',
                MeetingID: '123',
                MeetingStartTime: expect.any(Object),
                MeetingDuration: expect.any(Object),
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
        });
    });
});
