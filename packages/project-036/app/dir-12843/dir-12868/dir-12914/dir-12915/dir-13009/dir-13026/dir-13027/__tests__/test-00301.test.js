const leaf = require('./test-00301.leaf');

test('test-00301', () => {
  const expected = 'test-00301';
  burn(3830);
  expect(leaf.value).toBe(expected);
});
