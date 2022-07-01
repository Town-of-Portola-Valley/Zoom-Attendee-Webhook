'use strict';

const rewire = require('rewire');
const { DateTime, Duration } = require('luxon');

// Fish out private helper methods
const hLP = rewire('../handlers/handleListParticipants');
const handleListParticipants = hLP.handleListParticipants;
const sortJoinLeaveTimes = hLP.__get__('sortJoinLeaveTimes');
const activeBarWidth = hLP.__get__('activeBarWidth');
const timeToPercentage = hLP.__get__('timeToPercentage');
const participantProgressData = hLP.__get__('participantProgressData');

describe('listParticipants', () => {
    beforeEach(() => {
      jest.restoreAllMocks();
      jest.clearAllMocks();
    });

    describe('sortJoinLeaveTimes', () => {
        it('single join works', async () => {
            expect.assertions(1);

            const oneHourAgo = DateTime.now().minus({hours: 1});
            const result = await sortJoinLeaveTimes({
                JoinTimes: [oneHourAgo],
            });
            expect(result).toEqual([{time: oneHourAgo, state: 1}]);
        });

        it('single leave works', async () => {
            expect.assertions(1);

            const oneHourAgo = DateTime.now().minus({hours: 1});
            const result = await sortJoinLeaveTimes({
                LeaveTimes: [oneHourAgo],
            });
            expect(result).toEqual([{time: oneHourAgo, state: 0}]);
        });

        it('simultaneous join leave works', async () => {
            expect.assertions(1);

            const oneHourAgo = DateTime.now().minus({hours: 1});
            const result = await sortJoinLeaveTimes({
                JoinTimes: [oneHourAgo],
                LeaveTimes: [oneHourAgo],
            });
            expect(result).toEqual([{time: oneHourAgo, state: 1}, {time: oneHourAgo, state: 0}]);
        });

        it('join after leave works', async () => {
            expect.assertions(1);

            const oneHourAgo = DateTime.now().minus({hours: 1});
            const twoHoursAgo = DateTime.now().minus({hours: 2});
            const threeHoursAgo = DateTime.now().minus({hours: 3});
            const fourHoursAgo = DateTime.now().minus({hours: 4});

            const result = await sortJoinLeaveTimes({
                JoinTimes: [fourHoursAgo,twoHoursAgo],
                LeaveTimes: [threeHoursAgo,oneHourAgo],
            });
            expect(result).toEqual([{time: fourHoursAgo, state: 1},
                                   {time: threeHoursAgo, state: 0},
                                   { time: twoHoursAgo, state: 1 },
                                   { time: oneHourAgo, state: 0 }]);
        })
    });

    describe('activeBarWidth', () => {
        it('meeting ended', async () => {
            expect.assertions(1);

            const now = DateTime.now();
            const twoHoursAgo = now.minus({hours: 2});
            const oneHour = Duration.fromObject({hours: 1});
            const result = await activeBarWidth(twoHoursAgo,
                                                oneHour,
                                                now);
            expect(result).toBe(99);
        });

        it('95% duration exceeded', async () => {
            expect.assertions(1);

            const now = DateTime.now();
            const twoHoursAgo = now.minus({hours: 2});
            const oneHour = Duration.fromObject({hours: 1});
            const result = await activeBarWidth(twoHoursAgo,
                                                oneHour,
                                                undefined);
            expect(result).toBeCloseTo(95);
        });

        it('95% duration not reached', async () => {
            expect.assertions(1);

            const twoHoursAgo = DateTime.now().minus({hours: 2});
            const threeHours = Duration.fromObject({hours: 3});
            const result = await activeBarWidth(twoHoursAgo,
                                                threeHours,
                                                undefined);
            expect(result).toBeCloseTo(100);
        });

        it('95% duration on the nose', async () => {
            expect.assertions(1);

            const now = DateTime.now();
            const longAgo = now.minus({hours: 95});
            const longTime = Duration.fromObject({hours: 100});
            const result = await activeBarWidth(longAgo,
                                                longTime,
                                                undefined);
            expect(result).toBeCloseTo(95);
        });
    });

    describe('timeToPercentage', () => {
        it('meeting ended', async () => {
            expect.assertions(1);

            const now = DateTime.now();
            const halfHourAgo = now.minus({minutes: 30});
            const oneHourAgo = now.minus({hours: 1});
            const longTime = Duration.fromObject({hours: 30});
            const result = await timeToPercentage(halfHourAgo,
                                                  oneHourAgo,
                                                  longTime,
                                                  now);
            expect(result).toBeCloseTo(1/2 * 99);
        });

        it('95% duration exceeded in regulation', async () => {
            expect.assertions(1);

            const now = DateTime.now();
            const oneHourAgo = now.minus({hours: 1});
            const oneHour = Duration.fromObject({hours: 1});
            const result = await timeToPercentage(now,
                                                  oneHourAgo,
                                                  oneHour,
                                                  undefined);
            expect(result).toBeCloseTo(95);
        });

        it('95% duration exceeded in overtime', async () => {
            expect.assertions(1);

            const now = DateTime.now();
            const oneHourAgo = now.minus({hours: 1});
            const halfHour = Duration.fromObject({minutes: 30});
            const result = await timeToPercentage(now,
                                                  oneHourAgo,
                                                  halfHour,
                                                  undefined);
            expect(result).toBeCloseTo(95);
        });

        it('95% duration not reached in regulation', async () => {
            expect.assertions(1);

            const now = DateTime.now();
            const oneHourAgo = now.minus({hours: 1});
            const twoHours = Duration.fromObject({hours: 2});
            const result = await timeToPercentage(now,
                                                  oneHourAgo,
                                                  twoHours,
                                                  undefined);
            expect(result).toBeCloseTo(1/2 * 100);
        });

        it('95% duration not reached in overtime', async () => {
            expect.assertions(1);

            const now = DateTime.now();
            const halfHourAgo = now.minus({minutes: 30});
            const oneHourAgo = now.minus({hours: 1});
            const halfHour = Duration.fromObject({minutes: 30});
            const result = await timeToPercentage(halfHourAgo,
                                                  oneHourAgo,
                                                  halfHour,
                                                  undefined);
            expect(result).toBeCloseTo(1/2 * 95);
        });

        it('95% duration on the nose in regulation', async () => {
            expect.assertions(1);

            const now = DateTime.now();
            const longAgo = now.minus({hours: 95});
            const longTime = Duration.fromObject({hours: 100});
            const result = await timeToPercentage(now,
                                                  longAgo,
                                                  longTime,
                                                  undefined);
            expect(result).toBeCloseTo(95);
        });

        it('95% duration on the nose in overtime', async () => {
            expect.assertions(1);

            const now = DateTime.now();
            const longAgo = now.minus({hours: 96});
            const longTime = Duration.fromObject({hours: 100});
            const result = await timeToPercentage(now,
                                                  longAgo,
                                                  longTime,
                                                  undefined);
            expect(result).toBeCloseTo(95);
        });
    });

    describe('participantProgressData', () => {
        it('single join', async () => {
            expect.assertions(1);

            const oneHourAgo = DateTime.now().minus({hours: 1});
            const result = await participantProgressData({
                                                            JoinTimes: [oneHourAgo],
                                                         },
                                                         oneHourAgo,
                                                         Duration.fromObject({hours: 1}),
                                                         undefined);
            expect(result).toEqual([{ percent: 0, present: true }]);
        });
    });
});
