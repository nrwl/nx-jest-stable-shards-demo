const leaf = require('./test-04333.leaf');

test('test-04333', () => {
  const expected = 'test-04333';
  burn(2281);
  expect(leaf.value).toBe(expected);
});
