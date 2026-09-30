const leaf = require('./test-01603.leaf');

test('test-01603', () => {
  const expected = 'test-01603';
  burn(2309);
  expect(leaf.value).toBe(expected);
});
