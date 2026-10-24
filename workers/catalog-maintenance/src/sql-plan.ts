export type SqlOperation={sql:string;values:unknown[]}
/** D1 limits bound variables per statement. Group identical trusted INSERT
 * templates rather than spending one remote query per university/target. */
export function coalesceOperations(operations:SqlOperation[]):SqlOperation[] {
  const groups=new Map<string,SqlOperation[]>()
  for(const operation of operations){const group=groups.get(operation.sql)??[];group.push(operation);groups.set(operation.sql,group)}
  const result:SqlOperation[]=[]
  for(const [sql,group]of groups){
    const insert=/^(INSERT(?: OR IGNORE)? INTO [a-z_]+(?:\([^)]*\))? VALUES)(\([^)]*\))(.*)$/i.exec(sql)
    const deletion=/^(DELETE FROM [a-z_]+ WHERE [a-z_]+)=\?$/i.exec(sql)
    if(!insert&&!deletion){result.push(...group);continue}
    const width=group[0].values.length,rows=Math.max(1,Math.floor(100/Math.max(1,width)))
    for(let index=0;index<group.length;index+=rows){const chunk=group.slice(index,index+rows);result.push({sql:insert?`${insert[1]}${chunk.map(()=>insert[2]).join(',')}${insert[3]}`:`${deletion![1]} IN(${chunk.map(()=>'?').join(',')})`,values:chunk.flatMap(row=>row.values)})}
  }
  return result
}
