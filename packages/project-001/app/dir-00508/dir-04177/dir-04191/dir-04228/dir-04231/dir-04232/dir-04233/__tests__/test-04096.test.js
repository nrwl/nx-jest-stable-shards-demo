const leaf = require('./test-04096.leaf');

test('test-04096', () => {
  const expected = 'test-04096';
  burn(2281);
  expect(leaf.value).toBe(expected);
});
