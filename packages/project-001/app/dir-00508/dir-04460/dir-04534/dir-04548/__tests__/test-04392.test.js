const leaf = require('./test-04392.leaf');

test('test-04392', () => {
  const expected = 'test-04392';
  burn(2281);
  expect(leaf.value).toBe(expected);
});
