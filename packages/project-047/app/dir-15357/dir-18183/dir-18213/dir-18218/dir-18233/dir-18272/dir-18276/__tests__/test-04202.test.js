const leaf = require('./test-04202.leaf');

test('test-04202', () => {
  const expected = 'test-04202';
  burn(3830);
  expect(leaf.value).toBe(expected);
});
