const leaf = require('./test-04214.leaf');

test('test-04214', () => {
  const expected = 'test-04214';
  burn(2281);
  expect(leaf.value).toBe(expected);
});
