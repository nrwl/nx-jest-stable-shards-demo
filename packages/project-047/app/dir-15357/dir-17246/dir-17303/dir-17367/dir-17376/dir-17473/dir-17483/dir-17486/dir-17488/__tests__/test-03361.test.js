const leaf = require('./test-03361.leaf');

test('test-03361', () => {
  const expected = 'test-03361';
  burn(3830);
  expect(leaf.value).toBe(expected);
});
