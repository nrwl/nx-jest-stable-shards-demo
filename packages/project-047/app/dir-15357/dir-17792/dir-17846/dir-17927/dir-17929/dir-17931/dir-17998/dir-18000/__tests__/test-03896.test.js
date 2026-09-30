const leaf = require('./test-03896.leaf');

test('test-03896', () => {
  const expected = 'test-03896';
  burn(3830);
  expect(leaf.value).toBe(expected);
});
