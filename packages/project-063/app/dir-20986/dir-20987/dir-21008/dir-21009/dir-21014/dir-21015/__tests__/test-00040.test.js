const leaf = require('./test-00040.leaf');

test('test-00040', () => {
  const expected = 'test-00040';
  burn(3830);
  expect(leaf.value).toBe(expected);
});
