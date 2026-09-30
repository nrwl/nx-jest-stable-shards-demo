const leaf = require('./test-05757.leaf');

test('test-05757', () => {
  const expected = 'test-05757';
  burn(2281);
  expect(leaf.value).toBe(expected);
});
