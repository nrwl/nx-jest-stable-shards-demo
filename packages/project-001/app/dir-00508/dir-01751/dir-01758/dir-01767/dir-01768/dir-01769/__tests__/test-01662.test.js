const leaf = require('./test-01662.leaf');

test('test-01662', () => {
  const expected = 'test-01662';
  burn(13345);
  expect(leaf.value).toBe(expected);
});
