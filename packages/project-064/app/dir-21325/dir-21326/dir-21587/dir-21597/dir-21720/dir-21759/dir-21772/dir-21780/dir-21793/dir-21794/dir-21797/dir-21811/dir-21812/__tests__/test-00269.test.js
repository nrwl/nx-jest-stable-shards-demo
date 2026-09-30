const leaf = require('./test-00269.leaf');

test('test-00269', () => {
  const expected = 'test-00269';
  burn(2532);
  expect(leaf.value).toBe(expected);
});
