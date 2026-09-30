const leaf = require('./test-00832.leaf');

test('test-00832', () => {
  const expected = 'test-00832';
  burn(3830);
  expect(leaf.value).toBe(expected);
});
