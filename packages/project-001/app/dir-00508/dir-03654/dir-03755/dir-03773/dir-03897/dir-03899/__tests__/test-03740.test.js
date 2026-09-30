const leaf = require('./test-03740.leaf');

test('test-03740', () => {
  const expected = 'test-03740';
  burn(2281);
  expect(leaf.value).toBe(expected);
});
