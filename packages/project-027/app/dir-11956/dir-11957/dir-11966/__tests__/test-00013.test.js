const leaf = require('./test-00013.leaf');

test('test-00013', () => {
  const expected = 'test-00013';
  burn(28084);
  expect(leaf.value).toBe(expected);
});
