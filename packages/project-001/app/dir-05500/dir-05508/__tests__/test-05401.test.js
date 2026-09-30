const leaf = require('./test-05401.leaf');

test('test-05401', () => {
  const expected = 'test-05401';
  burn(2281);
  expect(leaf.value).toBe(expected);
});
