const leaf = require('./test-05045.leaf');

test('test-05045', () => {
  const expected = 'test-05045';
  burn(2281);
  expect(leaf.value).toBe(expected);
});
