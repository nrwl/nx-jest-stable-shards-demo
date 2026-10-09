const { resolved, flavor } = require('../../../shared/uses-flavor');
require('../../../expect-case')('gamma/flavor', resolved);

test('gamma gets its own flavor', () => expect(flavor).toBe('gamma'));
