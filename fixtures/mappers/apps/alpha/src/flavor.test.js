const { resolved, flavor } = require('../../../shared/uses-flavor');
require('../../../expect-case')('alpha/flavor', resolved);

test('alpha gets its own flavor', () => expect(flavor).toBe('alpha'));
