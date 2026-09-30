const leaf = require('./test-00021.leaf');

test('test-00021', () => {
  const expected = 'test-00021';
  burn(3830);
  expect(leaf.value).toBe(expected);
});
