const leaf = require('./test-01223.leaf');

test('test-01223', () => {
  const expected = 'test-01223';
  burn(3830);
  expect(leaf.value).toBe(expected);
});
