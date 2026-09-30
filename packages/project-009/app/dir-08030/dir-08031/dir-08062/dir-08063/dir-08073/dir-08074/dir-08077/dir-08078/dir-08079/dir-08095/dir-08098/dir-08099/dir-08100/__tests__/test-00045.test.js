const leaf = require('./test-00045.leaf');

test('test-00045', () => {
  const expected = 'test-00045';
  burn(25590);
  expect(leaf.value).toBe(expected);
});
