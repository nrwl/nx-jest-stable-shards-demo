const leaf = require('./test-01040.leaf');

test('test-01040', () => {
  const expected = 'test-01040';
  burn(3830);
  expect(leaf.value).toBe(expected);
});
