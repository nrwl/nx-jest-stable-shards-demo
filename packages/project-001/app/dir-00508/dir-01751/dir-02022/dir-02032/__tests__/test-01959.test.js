const leaf = require('./test-01959.leaf');

test('test-01959', () => {
  const expected = 'test-01959';
  burn(10219);
  expect(leaf.value).toBe(expected);
});
