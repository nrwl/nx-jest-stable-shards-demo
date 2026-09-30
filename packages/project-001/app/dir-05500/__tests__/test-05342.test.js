const leaf = require('./test-05342.leaf');

test('test-05342', () => {
  const expected = 'test-05342';
  burn(2281);
  expect(leaf.value).toBe(expected);
});
