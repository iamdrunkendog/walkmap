import {openDatabase,addUser,passwordHash} from './server.mjs';
import {createInterface} from 'node:readline/promises';
const [command,name]=process.argv.slice(2);
if(!['add-user','reset-password'].includes(command)||!name){console.error('사용법: node --env-file-if-exists=.env manage.mjs add-user|reset-password 아이디');process.exit(1);}
async function secret(){
  if(!process.stdin.isTTY){const r=createInterface({input:process.stdin});const value=await r.question('');r.close();return value;}
  process.stdout.write('비밀번호 (12자 이상, 표시되지 않음): ');process.stdin.setRawMode(true);process.stdin.resume();
  return new Promise((resolve,reject)=>{let value='';const input=data=>{for(const char of data.toString()){
    if(char==='\u0003'){process.stdin.setRawMode(false);process.exit(130);}
    if(char==='\r'||char==='\n'){process.stdin.off('data',input);process.stdin.setRawMode(false);process.stdin.pause();process.stdout.write('\n');resolve(value);return;}
    if(char==='\u007f')value=value.slice(0,-1);else value+=char;
  }};process.stdin.on('data',input);});
}
try{
  const password=await secret();const db=openDatabase();
  if(command==='add-user')await addUser(db,name,password);
  else{
    if(password.length<12||password.length>200)throw new Error('비밀번호는 12–200자여야 합니다.');
    const user=db.prepare('SELECT id FROM users WHERE name=?').get(name);if(!user)throw new Error('계정을 찾을 수 없습니다.');
    db.prepare('UPDATE users SET password=? WHERE id=?').run(await passwordHash(password),user.id);
    db.prepare('DELETE FROM sessions WHERE user_id=?').run(user.id);
  }
  db.close();console.log('계정 설정 완료');
}catch(e){console.error(e.message.includes('UNIQUE')?'이미 있는 아이디입니다.':e.message);process.exit(1);}
