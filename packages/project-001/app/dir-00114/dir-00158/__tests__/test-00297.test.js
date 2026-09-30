const leaf = require('./test-00297.leaf');

test('test-00297', () => {
  const expected = 'test-00297';
  burn(2212);
  expect(leaf.value).toBe(expected);
});
