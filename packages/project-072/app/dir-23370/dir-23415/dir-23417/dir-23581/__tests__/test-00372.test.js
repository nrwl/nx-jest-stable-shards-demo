const leaf = require('./test-00372.leaf');

test('test-00372', () => {
  const expected = 'test-00372';
  burn(3830);
  expect(leaf.value).toBe(expected);
});
