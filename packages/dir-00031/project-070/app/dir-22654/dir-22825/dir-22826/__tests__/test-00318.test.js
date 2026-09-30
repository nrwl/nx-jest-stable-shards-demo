const leaf = require('./test-00318.leaf');

test('test-00318', () => {
  const expected = 'test-00318';
  burn(4203);
  expect(leaf.value).toBe(expected);
});
