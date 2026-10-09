const { resolved, flavor } = require('../../../shared/uses-flavor');
require('../../../expect-case')('beta/flavor', resolved);

test('beta gets its own flavor', () => expect(flavor).toBe('beta'));
