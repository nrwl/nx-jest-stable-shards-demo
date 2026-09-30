const leaf = require('./test-05105.leaf');

test('test-05105', () => {
  const expected = 'test-05105';
  burn(2281);
  expect(leaf.value).toBe(expected);
});
