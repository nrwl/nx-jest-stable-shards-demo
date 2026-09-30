const leaf = require('./test-00174.leaf');

test('test-00174', () => {
  const expected = 'test-00174';
  burn(3830);
  expect(leaf.value).toBe(expected);
});
