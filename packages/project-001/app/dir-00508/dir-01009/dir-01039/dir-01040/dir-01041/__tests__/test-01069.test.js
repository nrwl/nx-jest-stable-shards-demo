const leaf = require('./test-01069.leaf');

test('test-01069', () => {
  const expected = 'test-01069';
  burn(13994);
  expect(leaf.value).toBe(expected);
});
