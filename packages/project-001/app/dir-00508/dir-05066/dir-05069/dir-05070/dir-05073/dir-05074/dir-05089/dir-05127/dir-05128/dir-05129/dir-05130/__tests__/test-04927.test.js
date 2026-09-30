const leaf = require('./test-04927.leaf');

test('test-04927', () => {
  const expected = 'test-04927';
  burn(2281);
  expect(leaf.value).toBe(expected);
});
