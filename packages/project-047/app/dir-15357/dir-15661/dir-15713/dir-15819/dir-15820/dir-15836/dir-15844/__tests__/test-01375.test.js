const leaf = require('./test-01375.leaf');

test('test-01375', () => {
  const expected = 'test-01375';
  burn(3830);
  expect(leaf.value).toBe(expected);
});
