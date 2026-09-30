const leaf = require('./test-00053.leaf');

test('test-00053', () => {
  const expected = 'test-00053';
  burn(3830);
  expect(leaf.value).toBe(expected);
});
