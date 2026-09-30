const leaf = require('./test-00401.leaf');

test('test-00401', () => {
  const expected = 'test-00401';
  burn(3830);
  expect(leaf.value).toBe(expected);
});
