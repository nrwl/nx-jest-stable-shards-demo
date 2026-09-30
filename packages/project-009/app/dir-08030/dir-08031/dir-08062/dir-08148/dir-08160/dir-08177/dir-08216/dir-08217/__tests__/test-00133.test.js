const leaf = require('./test-00133.leaf');

test('test-00133', () => {
  const expected = 'test-00133';
  burn(2956);
  expect(leaf.value).toBe(expected);
});
