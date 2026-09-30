const leaf = require('./test-00230.leaf');

test('test-00230', () => {
  const expected = 'test-00230';
  burn(3830);
  expect(leaf.value).toBe(expected);
});
